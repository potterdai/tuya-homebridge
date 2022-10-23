const BaseAccessory = require('./base_accessory')

let Accessory;
let Service;
let Characteristic;

class WindowCoveringAccessory extends BaseAccessory {

    constructor(platform, homebridgeAccessory, deviceConfig) {
        ({ Accessory, Characteristic, Service } = platform.api.hap);
        super(
            platform,
            homebridgeAccessory,
            deviceConfig,
            Accessory.Categories.WINDOW_COVERING,
            Service.WindowCovering
        );
        this.statusArr = deviceConfig.status;

        this.refreshAccessoryServiceIfNeed(this.statusArr, false);
    };

    /**
     * init Or refresh AccessoryService
     */
    refreshAccessoryServiceIfNeed(stateArr, isRefresh) {
        this.isRefresh = isRefresh;
        for (const statusMap of stateArr) {

            this.log.log('[refreshAccessoryServiceIfNeed] Target Position: %s', statusMap);

            //Check whether 100% is fully on or fully off. If there is no dp point, 100% is fully off by default
            if (statusMap.code === 'situation_set') {
                this.fullySituationMap = statusMap
            }

            // Characteristic.TargetPosition
            if (statusMap.code === 'percent_control') {
                this.percentControlMap = statusMap
                const percent = this._getCorrectPercent(parseInt(this.percentControlMap.value));
                this.setTargetPosition(percent);

                if (!this._isHaveDPCodeOfPercentState()) {
                    // Characteristic.CurrentPosition
                    this.setCurrentPosition(percent);
                }
            }

            if (statusMap.code === 'position') {
                this.percentControlMap = statusMap
                const percent = this._getCorrectPercent(parseInt(this.percentControlMap.value));
                this.setTargetPosition(percent);

                if (!this._isHaveDPCodeOfPercentState()) {
                    // Characteristic.CurrentPosition
                    this.setCurrentPosition(percent);
                }
            }

            if (statusMap.code === 'percent_state') {
                // Characteristic.CurrentPosition
                this.positionMap = statusMap
                this.setCurrentPosition(this._getCorrectPercent(this.positionMap.value));

                // Characteristic.PositionState
                // let hbValue = this.getHomeBridgeParam(Characteristic.PositionState,  this._getCorrectPercent(this.positionMap.value));
                // this.normalAsync(Characteristic.PositionState, hbValue);
            }
        }
    }

    /**
     * add get/set Accessory service Characteristic Listner
     */
    getAccessoryCharacteristic(name, props) {
        //set  Accessory service Characteristic
        this.service.getCharacteristic(name)
            .setProps(props || {})
            .onGet(async () => {
                if (this.hasValidCache()) {
                    return this.getCachedState(name);
                }
            })
            .onSet(async hbValue => {
                let percentValue = this._getCorrectPercent(hbValue)
                let tuyaParam = this.getTuyaParam(name, percentValue);
                this.platform.tuyaOpenApi.sendCommand(this.deviceId, tuyaParam).then(() => {
                    //store homebridge value
                    this.setCachedState(name, hbValue);
                    if (name === Characteristic.TargetPosition) {
                        this.isRefresh = true;
                        const currentPosition = this.getCachedState(Characteristic.CurrentPosition) ?? -1;
                        // It seems sometimes Tuya will not return the position state. Thus we will set to STOPPED after a timeout period.
                        this.setCurrentPosition(hbValue, this._calculateTimeoutTime(currentPosition, hbValue));
                    }
                }).catch((error) => {
                    this.log.error('[SET][%s] Characteristic Error: %s', this.homebridgeAccessory.displayName, error);
                    this.invalidateCache();
                });
            });
    }

    setTargetPosition(position) {
        this.log.log('[setTargetPosition] value: %d, CurrentState: %s', position, JSON.stringify(this.cachedState));

        this.normalAsync(Characteristic.TargetPosition, position);

        const currentPosition = this.getCachedState(Characteristic.CurrentPosition) ?? -1;
        if (position == currentPosition) {
            this.resetPositionState();
            return;
        }

        // It seems sometimes Tuya will not return the position state. Thus we will set to STOPPED after a timeout period.
        this.setCurrentPosition(position, this.isRefresh ? this._calculateTimeoutTime(currentPosition, position) : 0);
    }

    setCurrentPosition(position, delay) {
        this.log.log('[setCurrentPosition] value: %d, CurrentState: %s, withDelay: %d', position, JSON.stringify(this.cachedState), delay);

        if (delay != null && delay > 0) {
            if (this.positionStateTimeout != null) {
                clearTimeout(this.positionStateTimeout);
            }
            this.positionStateTimeout = setTimeout(() => {
                this.setCurrentPosition(position);
            }, delay);
            return;
        }

        if (this.positionStateTimeout != null) {
            clearTimeout(this.positionStateTimeout);
            this.positionStateTimeout = null;
        }

        this.normalAsync(Characteristic.CurrentPosition, position);
        if (this.validCache) {
            const targetPosition = this.getCachedState(Characteristic.TargetPosition);
            if (position == targetPosition) {
                this.resetPositionState();
            }
        }
    }

    resetPositionState() {
        this.log.log('[resetPositionState] value: %s, CurrentState: %s', "Stopped", JSON.stringify(this.cachedState));
        this.normalAsync(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
        if (this.positionStateTimeout != null) {
            clearTimeout(this.positionStateTimeout);
            this.positionStateTimeout = null;
        }
    }

    /**
     * get Tuya param from HomeBridge param
     */
    getTuyaParam(name, hbParam) {
        let code;
        let value;
        if (Characteristic.TargetPosition === name) {
            code = this.percentControlMap.code;
            value = hbParam;
            if (code === 'position') {
                value = "" + hbParam;
            }
        }
        return {
            "commands": [
                {
                    "code": code,
                    "value": value
                }
            ]
        };
    }

    /**
     * get HomeBridge param from tuya param
     */
    // getHomeBridgeParam(name, tuyaParam) {
    //     if (Characteristic.PositionState === name) {
    //         if (this.targetPosition) {
    //             if (this.targetPosition > tuyaParam) {
    //                 return Characteristic.PositionState.INCREASING;
    //             } else if (this.targetPosition < tuyaParam) {
    //                 return Characteristic.PositionState.DECREASING;
    //             } else {
    //                 return Characteristic.PositionState.STOPPED;
    //             }
    //         } else {
    //             return Characteristic.PositionState.STOPPED;
    //         }
    //     }
    // }

    /**
     * update HomeBridge state
     * @param {*} name HomeBridge Name
     * @param {*} hbValue HomeBridge Value
     */
    normalAsync(name, hbValue, props) {
        //store homebridge value
        this.setCachedState(name, hbValue);
        this.log.log("[normalAsync] isRefresh: %s", this.isRefresh);
        if (this.isRefresh) {
            this.service
                .getCharacteristic(name)
                .updateValue(hbValue);
        } else {
            this.getAccessoryCharacteristic(name, props);
        }
    }

    _getCorrectPercent(value) {
        var percent = value;
        if (this.fullySituationMap && this.fullySituationMap.value === 'fully_open') {
            return percent
        } else {
            percent = 100 - percent;
            return percent
        }
    }


    //Check whether the device supports percent_state dp code
    _isHaveDPCodeOfPercentState() {
        const percentStateDic = this.statusArr.find((item, index) => { return item.code.indexOf("percent_state") != -1 });
        if (percentStateDic) {
            return true;
        } else {
            return false;
        }
    }

    _calculateTimeoutTime(from, to) {
        if (from < 0 || to < 0) {
            return 5000;
        }
        return Math.abs(from - to) / 100 * 5000;
    }


    //Check Motor Reversed
    // _isMotorReversed() {
    //     let isMotorReversed
    //     for (const statusMap of this.statusArr) {
    //         switch (statusMap.code) {
    //             case 'control_back_mode':
    //                 if (statusMap.value === 'forward') {
    //                     isMotorReversed = false;
    //                 } else {
    //                     isMotorReversed = true;
    //                 }
    //                 break;
    //             case 'opposite':
    //             case 'control_back':
    //                 isMotorReversed = statusMap.value;
    //                 break;
    //             default:
    //                 break;
    //         }
    //     }
    //     this.log.log('[_isMotorReversed] result: %s Status: %s', isMotorReversed, JSON.stringify(this.statusArr));
    //     return isMotorReversed;
    // }

    /**
     * Tuya MQTT update device status
     */
    updateState(data) {
        this.refreshAccessoryServiceIfNeed(data.status, true);
    }

}

module.exports = WindowCoveringAccessory;