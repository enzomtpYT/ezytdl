const { getPath } = require(`./filenames/ytdlp`);
const child_process = require('child_process');
const fs = require('fs');
const idGen = require(`../util/idGen`);

const sanitize = require(`sanitize-filename`);

var ffmpegVideoCodecs = null;
var ffmpegRawVideoCodecsOutput = null;
var ffmpegPath = null;

const refreshVideoCodecs = () => {
    if(ffmpegPath && fs.existsSync(ffmpegPath)) {
        ffmpegRawVideoCodecsOutput = child_process.execFileSync(ffmpegPath, [`-codecs`, `-hide_banner`, `loglevel`, `error`]).toString().trim();
        ffmpegVideoCodecs = ffmpegRawVideoCodecsOutput.split(`\n`).filter(s => s[3] == `V`).map(s => s.split(` `)[2]);
    
        console.log(ffmpegVideoCodecs);
    }
}

var refreshFFmpeg = () => {
    ffmpegPath = require(`./filenames/ffmpeg`).getPath();
    if(ffmpegPath) refreshVideoCodecs();
};

refreshFFmpeg();

const time = require(`../util/time`);

const { updateStatus, updateStatusPercent } = require(`../util/downloadManager`);

const sendNotification = require(`../core/sendNotification`);

const getCodec = (file) => {
    let ffprobePath = require(`./filenames/ffmpeg`).getFFprobe();
    
    if(ffprobePath && fs.existsSync(ffprobePath)) {
        try {
            let a = child_process.execFileSync(ffprobePath, [`-v`, `error`, `-select_streams`, `v:0`, `-show_entries`, `stream=codec_name`, `-of`, `default=noprint_wrappers=1:nokey=1`, file]).toString().trim()
            //if(!a) a = child_process.execFileSync(ffprobePath, [`-v`, `error`, `-show_entries`, `stream=codec_name`, `-of`, `default=noprint_wrappers=1:nokey=1`, file]).toString().trim();
            if(a) {
                return a.trim().split(`\n`)[0]
            } else return null;
        } catch(e) {
            console.log(e);
            sendNotification({
                headingText: `Error!`,
                bodyText: `An error occured while trying to get the codec of a file! The download may be affected\n\nPath: ${file}\n\nError: ${e.toString()}`,
                type: `error`
            });
            return null;
        }
    } else return null
}

const sendUpdates = (proc, initialMsg) => {
    //downloading item {num} of {num}

    console.log(`sending updates...`);

    let firstUpdate = false;

    let downloadingList = false;

    proc.stderr.on(`data`, d => {
        if(!firstUpdate) {
            firstUpdate = true;
            updateStatus(initialMsg || `Getting media info...`)
        };
    
        const str = d.toString().trim();

        if(str.startsWith(`[download] Downloading item `) && str.includes(` of `)) {
            const num = parseInt(str.split(` of `)[0].split(` `).slice(-1)[0]);
            const total = parseInt(str.split(` of `)[1].split(` `)[0]);

            if(typeof num == `number` && typeof total == `number` && num > 1 && total > 1) {
                downloadingList = true;
                console.log(`Downloading item ${num} of ${total}...`)
                updateStatusPercent([num, total])
            }
        };

        if(!downloadingList) {
            if(str.includes(`page`) && str.toLowerCase().includes(`downloading`)) {
                updateStatusPercent([-1, 5])
            } else if(str.includes(`Extracting URL`)) {
                updateStatusPercent([1, 5])
            } else if(str.includes(`Downloading`)) {
                updateStatusPercent([3, 5])
            } else if(str.toLowerCase().includes(`format`)) {
                updateStatusPercent([4, 5])
            }
        }

        if(!str.startsWith(`[debug]`)) {
            updateStatus(str.split(`]`).slice(1).join(`]`).trim())
        }
    })
}

module.exports = {
    parseInfo: (d) => {
        let totalTime = 0;

        const map = e => {
            if(e.duration) {
                e.duration = time(e.duration*1000);
                totalTime += e.duration.units.ms;
            }

            if(e.timestamp) {
                e.released = time((Date.now()/60) - e.timestamp);
            }

            return e;
        }

        if(d.entries) d.entries = d.entries.map(map);
        if(d.formats) d.formats = d.formats.map(map);

        if(d.timestamp) {
            d.released = time((Date.now()/60) - d.timestamp);
        }

        d.duration = time(totalTime)

        return d
    },
    search: (query) => new Promise(async res => {
        const path = getPath();

        console.log(`going to path ${path}; query "${query}"`)

        let args = [`ytsearch10:${query}`, `--dump-single-json`, `--quiet`, `--verbose`, `--flat-playlist`];

        const proc = child_process.execFile(path, args);

        let data = ``;

        sendUpdates(proc, `Starting search for "${query}"`);

        proc.stdout.on(`data`, d => {
            //console.log(`output`, d.toString())
            data += d.toString().trim();
        });

        proc.on(`error`, e => {
            console.log(e)
        })

        proc.on(`close`, code => {
            console.log(`search closed with code ${code}`)
            console.log(data)
            const d = JSON.parse(data);
            res(module.exports.parseInfo(d))
            //console.log(d)
        })
    }),
    listFormats: (url, disableFlatPlaylist) => new Promise(async res => {
        const path = getPath();

        console.log(`going to path ${path}; url "${url}"`)

        let args = [url, `--dump-single-json`, `--quiet`, `--progress`, `--verbose`];

        if(!disableFlatPlaylist) args.push(`--flat-playlist`);

        const proc = child_process.execFile(path, args);

        let data = ``;

        sendUpdates(proc, `Starting info query of "${url}"`);

        proc.stdout.on(`data`, d => {
            //console.log(`output`, d.toString())
            data += d.toString().trim();
        });

        proc.on(`error`, e => {
            console.log(e)
        })

        proc.on(`close`, code => {
            console.log(`listFormats closed with code ${code}`)
            console.log(data)
            const d = JSON.parse(data);
            if(d && d.formats) {
                console.log(`formats found! resolving...`);
                res(module.exports.parseInfo(d))
            } else if(d && d.entries) {
                console.log(`entries found! adding time objects...`);

                let anyNoTitle = false;

                for (entry of d.entries) {
                    if(!entry.title) {
                        anyNoTitle = true;
                        break;
                    }
                };

                if(anyNoTitle && !disableFlatPlaylist) {
                    return module.exports.listFormats(url, true).then(res)
                } else {
                    res(module.exports.parseInfo(d))
                }
            } else if(!disableFlatPlaylist) {
                updateStatus(`Restarting playlist search... (there were no formats returned!!)`)
                console.log(`no formats found! starting over...`);
                return module.exports.listFormats(url, true).then(res)
            } else {
                sendNotification({
                    type: `error`,
                    headingText: `Error getting media info`,
                    bodyText: `Either the URL is invalid or the media is unavailable. Please try with a different link.`
                })
                return res(null);
            }
            //console.log(d)
        })
    }),
    getFilename: (url, format, template) => new Promise(async res => {
        const path = getPath();
        
        const { outputFilename } = require(`../getConfig`)();

        const args = [`-f`, format, url, `-o`, template || outputFilename, `--get-filename`, `--quiet`];

        const proc = child_process.execFile(path, args);

        let data = ``;

        proc.stderr.on(`data`, d => console.log(d.toString().trim()))

        proc.stdout.on(`data`, d => {
            //console.log(`output`, d.toString())
            data += d.toString().trim();
        });
        
        proc.on(`close`, code => {
            console.log(`getFilename closed with code ${code}`);
            console.log(data)
            res(data)
        })
    }),
    download: ({url, format, ext, convert, filePath, info}, updateFunc) => new Promise(async res => {
        const temporaryFilename = `ezytdl-` + idGen(24);
        
        let obj = {};

        let proc;

        let update = (o) => {
            obj = Object.assign({}, obj, o);
            updateFunc({ latest: o, overall: obj }, proc);
        };

        let filenames = [];
        
        const purgeLeftoverFiles = (saveTo) => {
            const purgeFiles = (from, filename) => {
                let findFiles = filename;

                if(findFiles.startsWith(temporaryFilename)) {
                    findFiles = temporaryFilename;
                } else if(findFiles.endsWith(`.part`)) {
                    findFiles = findFiles.split(`.part`).slice(0, -1).join(`.part`)
                } else if(findFiles.endsWith(`.ytdl`)) {
                    findFiles = findFiles.split(`.part`).slice(0, -1).join(`.ytdl`)
                }

                if(findFiles) {
                    const dir = fs.readdirSync(saveTo);
    
                    const prevFiles = dir.filter(f => f.startsWith(findFiles));
                    console.log(`${from} / files:`, prevFiles, `from:`, dir, `starting with:`, findFiles);
    
                    prevFiles.forEach(f => {
                        const file = require(`path`).join(saveTo, f);
                        update({status: `Removing ${from} file ${file} ...`})
                        console.log(`removing previous ${from} file ${file}`);
                        try {
                            if(fs.existsSync(file)) {
                                console.log(`removing ${file}...`)
                                fs.unlinkSync(file)
                            } else console.log(`${file} nonexistent?`)
                        } catch(e) {
                            console.log(`failed removing ${file}: ${e}`)
                        }
                    });
    
                    if(fs.existsSync(saveTo + filename)) {
                        console.log(`original file removing...`)
                        fs.unlinkSync(saveTo + filename);
                    } else console.log(`original file nonexistent?`)
                }
            };

            filenames.forEach((f, i) => {
                console.log(`purging files from index ${i}: ${f}`)
                purgeFiles(`${i}`, f)
            });

            updateFunc({status: `Download cancelled.`})

            res(obj)
        }

        try {
            const path = getPath();

            let ytdlpFilename = sanitize(await module.exports.getFilename(url, format));
            
            filenames.push(ytdlpFilename)
            filenames.push(temporaryFilename)
    
            const { saveLocation, onlyGPUConversion, disableHWAcceleratedConversion } = require(`../getConfig`)();
    
            if(!ffmpegPath || !ffmpegVideoCodecs) refreshFFmpeg();
    
            console.log(saveLocation, filePath, ytdlpFilename)
    
            const saveTo = (filePath || saveLocation) + (require('os').platform() == `win32` ? `\\` : `/`)

            updateFunc({ deleteFiles: () => purgeLeftoverFiles(saveTo) })
    
            fs.mkdirSync(saveTo, { recursive: true, failIfExists: false });
            
            const args = [`-f`, format, url, `-o`, saveTo + ytdlpFilename + `.%(ext)s`, `--no-mtime`];
    
            let downloadInExt = null;
    
            let reasonConversionNotDone = null;
    
            if(fs.existsSync(ffmpegPath)) {
                args.push(`--ffmpeg-location`, ffmpegPath);
            } else {
                if(convert && convert.ext) {
                    ext = convert.ext
                    convert = false;
                    reasonConversionNotDone = `ffmpeg not installed`
                };
            }
            
            if(convert && !ext) {
                args[4] = args[4].replace(ytdlpFilename, temporaryFilename);
                args.splice(5, 2);
            } else if((format == `bv*+ba/b` || format == `bv`) && ext) {
                if(format == `bv`) {
                    args.splice(2, 0, `-S`, `ext:${ext}`)
                    downloadInExt = ext
                } else {
                    args.splice(2, 0, `-S`, `ext:${ext}:m4a`)
                    downloadInExt = ext + `:m4a`
                };
            } else if(format == `ba` && ext) {
                args.splice(2, 0, `-S`, `ext:${ext}`);
    
                downloadInExt = ext
            }
            
            console.log(`saveTo: ` + saveTo, `\n- ` + args.join(`\n- `))
    
            proc = child_process.execFile(path, args);
    
            killAttempt = 0;
    
            update({saveLocation: saveTo, url, format, kill: () => {
                killAttempt++
                proc.kill(`SIGKILL`);
            }, status: `Downloading...`})
    
            proc.stdout.on(`data`, data => {
                const string = data.toString();
    
                //console.log(string.trim());
    
                if(string.includes(`Destination:`)) {
                    update({destinationFile: string.split(`Destination:`)[1].trim()});
                    if(!filenames.find(s => s == obj.destinationFile)) filenames.push(obj.destinationFile)
                }
    
                const percent = string.includes(`%`) ? string.split(`%`)[0].split(` `).slice(-1)[0] : null;
                if(percent) {
                    const downloadSpeed = string.includes(`/s`) ? string.split(`/s`)[0].split(` `).slice(-1)[0] + `/s` : `-1B/s`;
                    const eta = string.includes(`ETA`) ? string.split(`ETA`)[1].split(` `).slice(1).join(` `) : `00:00`;
                    //console.log(percent)
                    update({percentNum: Number(percent), downloadSpeed, eta});
                }
            });
    
            proc.stderr.on(`data`, data => {
                const string = data.toString();
    
                console.log(string.trim())
            })
            
            proc.on(`close`, async code => {
                update({kill: () => {killAttempt++}});
    
                let previousFilename = obj.destinationFile ? `ezytdl` + obj.destinationFile.split(`ezytdl`).slice(-1)[0] : temporaryFilename;

                const fallback = (msg, deleteFile) => {
                    try {
                        console.log(`ffmpeg did not save file, renaming temporary file`);
                        if(deleteFile) {
                            fs.unlinkSync(saveTo + previousFilename)
                        } else {
                            fs.renameSync(saveTo + previousFilename, saveTo + ytdlpFilename + `.` + previousFilename.split(`.`).slice(-1)[0]);
                        }
                    } catch(e) { console.log(e) }
                    update({failed: true, percentNum: 100, status: `Could not convert to ${`${convert.ext}`.toUpperCase()}.` + msg && typeof msg == `string` ? `\n\n${msg}` : ``, saveLocation: saveTo, destinationFile: saveTo + ytdlpFilename + `.` + previousFilename.split(`.`).slice(-1)[0], url, format});
                    return res(obj)
                    //purgeLeftoverFiles(saveTo)
                };
    
                if(killAttempt > 0) return fallback(`Download canceled.`, true);

                filenames.push(ytdlpFilename)
    
                if(!fs.existsSync(previousFilename)) previousFilename = await module.exports.getFilename(url, format, temporaryFilename + `.%(ext)s`);
    
                filenames.push(previousFilename)

                if(convert) {
                    const savedExt = fs.readdirSync(saveTo).find(s => s.startsWith(previousFilename)).split(`.`).slice(-1)[0]

                    console.log(`extensions`, downloadInExt, (convert || {}).ext, ext, savedExt)

                    ext = `.${convert.ext}`

                    const inputArgs = [`-i`, saveTo + previousFilename];
                    const outputArgs = [saveTo + ytdlpFilename + ext];

                    if(convert.audioBitrate) outputArgs.unshift(`-b:a`, convert.audioBitrate);
                    if(convert.audioSampleRate) outputArgs.unshift(`-ar`, convert.audioSampleRate);
                    if(convert.videoBitrate) outputArgs.unshift(`-b:v`, convert.videoBitrate);
                    if(convert.videoFPS) outputArgs.unshift(`-r`, convert.videoFPS);
                    if(convert.videoResolution) outputArgs.unshift(`-vf`, `scale=${convert.videoResolution.trim().replace(`x`, `:`)}`);

                    const mainArgs = [...inputArgs, ...outputArgs];

                    console.log(`mainArgs: `, mainArgs)
    
                    const spawnFFmpeg = (args2, name) => new Promise((resolveFFmpeg, rej) => {
                        if(killAttempt > 0) {
                            update({failed: true, percentNum: 100, status: `Download canceled.`, saveLocation: saveTo, destinationFile: saveTo + ytdlpFilename + `.${ext}`, url, format})
                            return res(obj)
                            //purgeLeftoverFiles(saveTo)
                            //return res(`Download canceled.`, true);
                        }
    
                        console.log(`- ` + args2.join(`\n- `))
    
                        update({status: `Converting to ${`${ext}`.toUpperCase()} using ${name}...<br><br>- ${Object.keys(convert).map(s => `${s}: ${convert[s] || `(no conversion)`}`).join(`<br>- `)}`, percentNum: -1, eta: `--`});
    
                        proc = child_process.execFile(ffmpegPath, [`-y`, ...args2]);
                        
                        update({kill: () => {
                            killAttempt++
                            proc.kill(`SIGKILL`);
                        }})
        
                        let duration = null;
        
                        proc.stderr.on(`data`, d => {
                            const data = `${d}`
        
                            console.log(`STDERR | ${data.trim()}`);
                            if(data.includes(`Duration:`)) {
                                duration = time(data.trim().split(`Duration:`)[1].trim().split(`,`)[0]).units.ms;
                                console.log(`duration: `, duration)
                            };
        
                            if(data.includes(`time=`)) {
                                const timestamp = time(data.trim().split(`time=`)[1].trim().split(` `)[0]).units.ms;
                                update({percentNum: (Math.round((timestamp / duration) * 1000))/10})
                            }
    
                            let speed = [];
    
                            if(data.includes(`fps=`)) speed.push(data.trim().split(`fps=`)[1].trim().split(` `)[0] + `fps`);
        
                            if(data.includes(`speed=`)) speed.push(data.trim().split(`speed=`)[1].trim().split(` `)[0]);
                            
                            if(speed) update({downloadSpeed: speed.join(` | `)})
                        });
        
                        proc.stdout.on(`data`, data => {
                            console.log(`STDOUT | ${data.toString().trim()}`)
                        });
        
                        proc.on(`close`, (code) => {
                            if(killAttempt > 0) {
                                update({failed: true, percentNum: 100, status: `Download canceled.`, saveLocation: saveTo, destinationFile: saveTo + ytdlpFilename + `.${ext}`, url, format})
                                return res(obj)
                                //return purgeLeftoverFiles(saveTo)
                                //return res(`Download canceled.`, true);
                            } else if(code == 0) {
                                console.log(`ffmpeg completed; deleting temporary file...`);
                                fs.unlinkSync(saveTo + previousFilename);
                                update({percentNum: 100, status: `Done!`, saveLocation: saveTo, destinationFile: saveTo + ytdlpFilename + `.${ext}`, url, format});
                                resolveFFmpeg(obj)
                            } else {
                                rej(code)
                            }
                        })
                    });
    
                    const transcoders = await (require(`./determineGPUDecode`))()
    
                    console.log(`Retrieving filename`);
                    
                    obj.destinationFile = ytdlpFilename;
    
                    console.log(`file extension was provided! continuing with ffmpeg...`, obj.destinationFile);
    
                    const decoder = transcoders.use;
    
                    console.log(`using decoder: `, decoder);
    
                    const thisCodec = getCodec(saveTo + previousFilename);
    
                    if(thisCodec && !disableHWAcceleratedConversion && decoder) {
                        console.log(`doing video conversion! onlyGPU: ${onlyGPUConversion}`);
                        
                        decoder.codecName = thisCodec + `_` + decoder.string;
    
                        console.log(transcoders)
    
                        let compatibleTranscoders = Object.values(transcoders).filter(o => {
                            if(typeof o == `object`) {
                                const str = thisCodec + `_` + o.string;
                                console.log(str + ` - compatible? ${ffmpegRawVideoCodecsOutput.includes(str)}`)
                                return ffmpegRawVideoCodecsOutput.includes(str)
                            } else return false;
                        }).map(o => {
                            return Object.assign({}, o, {
                                codecName: thisCodec + `_` + o.string
                            })
                        });
    
                        const fallbackToDecoderOnly = () => {
                            console.log(`fallback to decoder only`);
    
                            if(decoder && decoder.name) {
                                spawnFFmpeg([...decoder.pre, ...inputArgs, ...decoder.post, ...outputArgs], `${thisCodec}_software/Dec + ` + `${decoder.post[decoder.post.indexOf(`-c:v`)+1]}` + `/Enc`).then(res).catch(e => {
                                    console.log(`FFmpeg failed converting -- ${e}; trying again...`)
                                    spawnFFmpeg([...inputArgs, ...decoder.post, `-c:v`, `h264`, ...outputArgs], `${thisCodec}_software/Dec + ` + `${decoder.post[decoder.post.indexOf(`-c:v`)+1]}` + `/Enc`).then(res).catch(e => {
                                        console.log(`FFmpeg failed converting -- ${e}; trying again...`)
                                        spawnFFmpeg([...decoder.pre, ...inputArgs, `-c:v`, `h264`, ...outputArgs], `${thisCodec}_software/Dec + ` + `h264_software/Enc`).then(res).catch(e => {
                                            console.log(`FFmpeg failed converting -- ${e}; trying again...`);
                                            if(onlyGPUConversion) {
                                                return fallback(`The video codec (${thisCodec}) provided by the downloaded format is not compatible with FFmpeg's GPU transcoding.`);
                                            } else spawnFFmpeg([...inputArgs, `-c:v`, `h264`, ...outputArgs], `${thisCodec}_software`).then(res).catch(fallback)
                                        })
                                    })
                                })
                            } else spawnFFmpeg(mainArgs, `${thisCodec}_software`).then(res).catch(fallback)
                        };
    
                        console.log(compatibleTranscoders)
    
                        if(compatibleTranscoders.length > 0) {
                            let done = false;
    
                            for(let transcoder of compatibleTranscoders) {
                                console.log(`trying ${transcoder.name}...`);
                                
                                try {
                                    const conversionProc = await spawnFFmpeg([`-c:v`, transcoder.codecName, ...inputArgs, ...decoder.post, ...outputArgs], transcoder.codecName + `/Dec + ` + `${decoder.post[decoder.post.indexOf(`-c:v`)+1]}` + `/Enc`);
                                    done = true;
                                    res(conversionProc)
                                    break;
                                } catch(e) {
                                    try {
                                        const conversionProc = await spawnFFmpeg([`-c:v`, transcoder.codecName, ...inputArgs, ...transcoder.post, ...outputArgs], transcoder.codecName + `/Dec + ` + `${transcoder.post[transcoder.post.indexOf(`-c:v`)+1]}` + `/Enc`);
                                        done = true;
                                        res(conversionProc)
                                        break;
                                    } catch(e) {
                                        try {
                                            const conversionProc = await spawnFFmpeg([...inputArgs, ...transcoder.post, ...outputArgs], `${thisCodec}_software` + `/Dec + ` + `${transcoder.post[transcoder.post.indexOf(`-c:v`)+1]}` + `/Enc`);
                                            done = true;
                                            res(conversionProc)
                                            break;
                                        } catch(e) {
                                            console.log(`FFmpeg failed converting -- ${e}; trying again...`)
                                        }
                                    }
                                }
                            };
    
                            if(!done) fallbackToDecoderOnly();
                        } else fallbackToDecoderOnly();
                    } else {
                        spawnFFmpeg(mainArgs, `software`).then(res).catch(fallback)
                    }
                } else if(!convert) {
                    if(killAttempt > 0) {
                        update({failed: true, percentNum: 100, status: `Download canceled.`, saveLocation: saveTo, destinationFile: saveTo + ytdlpFilename + `.${ext}`, url, format})
                        return res(obj)
                        //purgeLeftoverFiles(saveTo)
                    } else if(args.includes(`-S`)) {
                        update({code, saveLocation, url, format, status: `Downloaded best quality provided for ${ext} format (no conversion done${reasonConversionNotDone ? ` -- ${reasonConversionNotDone}` : ``})`});
                    } else if(reasonConversionNotDone) {
                        update({code, saveLocation, url, format, status: `Could not convert: ${reasonConversionNotDone}`});
                    } else update({code, saveLocation, url, format, status: `Done!`});
                    res(obj)
                } else {
                    if(killAttempt > 0) {
                        update({failed: true, percentNum: 100, status: `Download canceled.`, saveLocation: saveTo, destinationFile: saveTo + ytdlpFilename + `.${ext}`, url, format})
                        return res(obj)
                        //purgeLeftoverFiles(saveTo)
                    } else {
                        update({code, saveLocation, url, format, status: `Done!`})
                        res(obj)
                    }
                }
            })
        } catch(e) {
            console.error(e);
            sendNotification({
                type: `error`,
                headingText: `Error downloading media (${format} / ${info && info.title ? info.title : `unknown`})`,
                bodyText: `An error occured while trying to download the media.\n\nError: ${e.toString()}`
            });
            update({ failed: true, status: `${e.toString()}` })
        }
    })
}