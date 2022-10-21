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
                this.setTargetPosition(this._getCorrectPercent(this.percentControlMap.value));

                if (!this._isHaveDPCodeOfPercentState()) {
                    // Characteristic.CurrentPosition
                    this.setCurrentPosition(this._getCorrectPercent(this.percentControlMap.value));
                }
            }

            if (statusMap.code === 'position') {
                this.percentControlMap = statusMap
                const percent = this._getCorrectPercent(parseInt(this.percentControlMap.value))
                this.setTargetPosition(percent);

                if (!this._isHaveDPCodeOfPercentState()) {
                    // Characteristic.CurrentPosition
                    this.setCurrentPosition(percent);
                }
            }

            if (statusMap.code === '    ') {
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
            .on('get', callback => {
                if (this.hasValidCache()) {
                    callback(null, this.getCachedState(name));
                }
            })
            .on('set', (hbValue, callback) => {
                let percentValue = this._getCorrectPercent(hbValue)
                let tuyaParam = this.getTuyaParam(name, percentValue);
                this.platform.tuyaOpenApi.sendCommand(this.deviceId, tuyaParam).then(() => {
                    //store homebridge value
                    this.setCachedState(name, hbValue);
                    // //store targetPosition value
                    // this.targetPosition = percentValue;
                    callback();
                }).catch((error) => {
                    this.log.error('[SET][%s] Characteristic Error: %s', this.homebridgeAccessory.displayName, error);
                    this.invalidateCache();
                    callback(error);
                });
            });
    }

    setTargetPosition(position) {
        this.log.log('[setTargetPosition] Target Position: %d, Current Position: %d', position, this.currentPosition);

        this.targetPosition = position;
        this.normalAsync(Characteristic.TargetPosition, position);

        if (this.targetPosition == this.currentPosition) {
            this.resetPositionState();
            return;
        }

        // It seems sometimes Tuya will not return the position state. Thus we will set to STOPPED after a timeout period.
        if (this.positionStateTimeout != null) {
            clearTimeout(this.positionStateTimeout);
        }
        this.positionStateTimeout = setTimeout(() => {
            this.setCurrentPosition(position);
        }, 5000);
    }

    setCurrentPosition(position) {
        this.log.log('[setCurrentPosition] Target Position: %d, Current Position: %d', this.targetPosition, position);
        this.currentPosition = position;
        this.normalAsync(Characteristic.CurrentPosition, position);
        if (this.currentPosition == this.targetPosition) {
            this.resetPositionState();
        }
    }

    resetPositionState() {
        this.log.log('[resetPositionState] Target Position: %d, Current Position: %d', this.targetPosition, this.currentPosition);
        this.normalAsync(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
        if (this.positionStateTimeout != null) {
            clearTimeout(this.positionStateTimeout);
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