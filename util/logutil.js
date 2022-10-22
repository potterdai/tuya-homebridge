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
    args[0] = '[' + (new Date()).toISOString() + '] ' + args[0]
    return  args;
}

module.exports = LogUtil;
