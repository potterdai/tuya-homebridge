class LogUtil {
    constructor(isDebug = false) {
        this.isDebug = isDebug;
    }

    log(...args) {
        if (this.isDebug) {
            console.log(...prependTimestamp(args));
        }
    }

    error(...args) {
        if (this.isDebug) {
            console.log(...prependTimestamp(args));
        }
    }
}

function prependTimestamp(args) {
    return ['[' + (new Date()).toISOString() + ']', ...args];
};

module.exports = LogUtil;
