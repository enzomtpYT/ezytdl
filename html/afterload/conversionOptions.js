let hasFFmpeg = false;

const conversionOptions = (node, info) => {
    //node.querySelector(`#saveLocation`).placeholder = `${config && config.saveLocation ? config.saveLocation : `{default save location}`}`;
    //node.querySelector(`#saveLocation`).value = `${config && config.saveLocation ? config.saveLocation : ``}`;
    node.querySelector(`#basedir`).innerText = `${info.saveLocation || (config && config.saveLocation ? config.saveLocation : `Save Location`)}`;

    //console.log(`config`, config)

    //console.log(`video conversion enabled`)
    if(info.resolution) node.querySelector(`#videoResolution`).placeholder = `${info.resolution}`
    if(info.vbr) node.querySelector(`#videoBitrate`).placeholder = `Bitrate (${info.vbr}k)`
    if(info.fps) node.querySelector(`#videoFPS`).placeholder = `FPS (${info.fps})`

    //console.log(`audio conversion enabled`)
    if(info.asr) node.querySelector(`#audioSampleRate`).placeholder = `Sample Rate (${info.asr/1000}k)`
    if(info.abr) node.querySelector(`#audioBitrate`).placeholder = `Bitrate (${info.abr}k)`;

    const metaButtons = node.querySelector(`#metadataOptions`).querySelectorAll(`.btn`)
    
    if(hasFFmpeg) {
        node.querySelector(`#convertDownload`).onclick = () => {
            const ffmpegOptions = node.querySelector(`#ffmpegOptions`);
    
            ffmpegOptions.classList.remove(`d-none`);
    
            const ffmpegBoundingClientRect = ffmpegOptions.getBoundingClientRect()
    
            console.log(ffmpegBoundingClientRect.height);
    
            const formattxtbox = node.querySelector(`#formatConversionTextbox`);
    
            formattxtbox.parentElement.removeChild(formattxtbox);
    
            node.querySelector(`#conversionDiv`).appendChild(formattxtbox);
    
            const add = [
                parseInt(window.getComputedStyle(ffmpegOptions).marginBottom),
                parseInt(window.getComputedStyle(ffmpegOptions).marginTop),
                parseInt(window.getComputedStyle(node).marginTop),
            ]
    
            const newHeight = (ffmpegBoundingClientRect.height + add.reduce((a, b) => a + b, 0));
    
            console.log(`newHeight`, newHeight)
    
            if(config.reduceAnimations) {
                ffmpegOptions.style.maxHeight = newHeight + `px`;
                anime({
                    targets: ffmpegOptions,
                    opacity: [`0%`, `100%`],
                    duration: 500,
                    easing: `easeOutExpo`,
                    complete: () => {
                        ffmpegOptions.style.maxHeight = ``;
                    }
                });
            } else {
                anime({
                    targets: ffmpegOptions,
                    maxHeight: [`0px`, newHeight + `px`],
                    opacity: [`0%`, `100%`],
                    duration: 500,
                    easing: `easeOutExpo`,
                    complete: () => {
                        ffmpegOptions.style.maxHeight = ``;
                    }
                });
            }
    
            anime({
                targets: node.querySelector(`#convertDownload`),
                width: [`49%`, `0%`],
                maxWidth: [`49%`, `0%`],
                padding: 0,
                opacity: [1, 0],
                duration: 500,
                easing: `easeOutExpo`,
            });
    
            anime({
                targets: node.querySelector(`#confirmDownload`),
                width: [`49%`, `100%`],
                duration: 500,
                easing: `easeOutExpo`,
            });
        }

        metaButtons.forEach(m => {
            const icon = m.querySelector(`#icon`);
    
            m.onclick = () => {
                if(m.getAttribute(`value`) == `true`) {
                    m.setAttribute(`value`, `false`);
                    if(icon.classList.contains(`fa-check-circle`)) {
                        icon.classList.remove(`fa-check-circle`);
                        icon.classList.add(`fa-times-circle`);
                    }
    
                    anime.remove(m);
                    anime({
                        targets: m,
                        scale: 0.9,
                        opacity: 0.65,
                        duration: 300,
                        easing: `easeOutExpo`,
                    })
                } else {
                    m.setAttribute(`value`, `true`);
                    if(icon.classList.contains(`fa-times-circle`)) {
                        icon.classList.remove(`fa-times-circle`);
                        icon.classList.add(`fa-check-circle`);
                    }
    
                    anime.remove(m);
                    anime({
                        targets: m,
                        scale: 1,
                        opacity: 1,
                        duration: 300,
                        easing: `easeOutExpo`,
                    })
                }
            }
        });
    } else {
        let sentNotif = false;
        metaButtons.forEach(m => {
            const icon = m.querySelector(`#icon`);
            m.style.scale = 0.9;
            m.style.opacity = 0.65;
            m.onclick = () => {
                if(!sentNotif) {
                    sentNotif = true;
                    createNotification({
                        headingText: `FFmpeg not found!`,
                        bodyText: `FFmpeg is required to add metadata. Please install FFmpeg and try again.`,
                        type: `warn`
                    });
                }
                buttonDisabledAnim(m, {
                    opacity: [0.75, 0.65],
                });
            }
            if(icon.classList.contains(`fa-check-circle`)) {
                icon.classList.remove(`fa-check-circle`);
                icon.classList.add(`fa-times-circle`);
            }
        });

        console.log(node.querySelector(`#confirmDownload`).parentElement, node.querySelector(`#convertDownload`))

        node.querySelector(`#confirmDownload`).style.width = `100%`;
        node.querySelector(`#convertDownload`).classList.add(`d-none`)
        //node.querySelector(`#convertDownload`).style.width = `0%`;
        //node.querySelector(`#convertDownload`).style.maxWidth = `0%`;
        //node.querySelector(`#convertDownload`).style.padding = `0px`;
        //node.querySelector(`#convertDownload`).style.opacity = `0`;
    }
}