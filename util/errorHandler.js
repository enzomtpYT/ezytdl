const sendNotification = require(`../core/sendNotification`)

module.exports = (err) => {
    console.error(err)

    const str = `${err}\n\n${typeof err == `object` && err.stack? err.stack : `(no stack)`}`

    const notifSent = sendNotification({
        headingText: `Internal error occurred!`,
        bodyText: str,
        type: `error`
    });

    if(!notifSent) return require('./errorAndExit')(str)
}