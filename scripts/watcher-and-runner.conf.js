'use strict';
/*
 * This is a config file for watcher and runner microservice built on fs-watcher lib
 * Here you can define folders and files that will be watched and define a callbacks
 * that will be run if in those folders or files change smth
 *
 * Example structure for options
 *
    options[<serve url>] = {
        callbacks: {
            create: () => {},
            change: () => {},
            delete: () => {},
            any: () => {}   // optionally -> if exists that previous will be ignored
        },
        runImmediately: () => {},       // optionally task will be run Immediately
        includeDir: (fullNamePath) => {},   // optionally
        includeFile: (fullNamePath) => {}   // optionally
    };
 *
 * You can build this file with any rules and also without process env variables
*/

const path = require('path');
const FILENAME = path.basename(__filename).replace(path.extname(path.basename(__filename)), '');

const CONSTANTS = {
    SERVER__SRC_FOLDER:             process.env.SERVER__SRC_FOLDER,
    SERVER__BUILD_FOLDER:           process.env.SERVER__BUILD_FOLDER,
    CONFIGS_SERVICES__DIR:          process.env.CONFIGS_SERVICES__DIR,
    SERVER__SRC_TEST_FOLDER:        process.env.SERVER__SRC_TEST_FOLDER,
    CONCURRENTLY_WRAPPER__PORT:     process.env.CONCURRENTLY_WRAPPER__PORT
};

CONSTANTS.SERVER__SRC_FOLDER = path.normalize(CONSTANTS.SERVER__SRC_FOLDER);
CONSTANTS.SERVER__BUILD_FOLDER = path.normalize(CONSTANTS.SERVER__BUILD_FOLDER);
CONSTANTS.SERVER__SRC_TEST_FOLDER = path.normalize(CONSTANTS.SERVER__SRC_TEST_FOLDER);

for (let key in CONSTANTS) {
    if (!CONSTANTS[key]) {
        console.log(`${FILENAME}: You must set ${key} env!`);
        process.exit(1);
    }
}

const options =  {};
const fs = require('fs');
const fse = require('fs-extra');
const imagemin = require('imagemin');
const UglifyJS = require("uglify-js");
const terminate = require('terminate');
const exec = require('child_process').exec;
const recursive = require("recursive-readdir");
const imageminOptipng = require('imagemin-optipng');
const imageminJpegtran = require('imagemin-jpegtran');

const deniedFilesToCopyFromServerSrcToBuild = [
    'ts',
    'tsx'
];

const copyAllFileFromServerToBuild = () => {
    return new Promise((resolve, reject) => {
        recursive(
            CONSTANTS.SERVER__SRC_FOLDER,
            [
                (fileName, stats) => {
                    let ext = fileName.split('.').pop().toLowerCase();
                    return !stats.isDirectory() && deniedFilesToCopyFromServerSrcToBuild.reduce((bool, extension) => {
                            return extension === ext ? !!(++bool) : !!bool
                        }, false);
                }
            ],
            (err, files) => {
                if (err) {
                    reject(err);
                    return false;
                }
                let promises = [];
                files.forEach(fileName => {
                    promises.push(
                        copyFilesWithFilters(fileName.replace(CONSTANTS.SERVER__SRC_FOLDER, CONSTANTS.SERVER__BUILD_FOLDER), fileName)
                    );
                });
                Promise.all(promises)
                    .then(() => {
                        resolve(files);
                    })
                    .catch(reject);
            }
        );
    });
};

const copyFilesWithFilters = (to, from, options) => {
    let ext = from.split('.').pop().toLowerCase()
        ,file = fs.readFileSync(from)
        ;
    if (
            ext === 'jpg'
        ||  ext === 'png'
        ||  ext === 'gif'
        ||  ext === 'jpeg'
        ||  ext === 'bmp'
        ||  ext === 'tiff'
    ) {
        return new Promise((resolve, reject) => {
            imagemin.buffer(file, {
                plugins: [
                    // imageminJpegtran(),
                    // imageminOptipng()
                ]
            })
            .then((buffer) => {
                fse.outputFileSync(to, buffer);
                resolve();
            })
            .catch(reject);
        });
    } else if ( ext === 'js' ) {
        UglifyJS.minify(file);
        fse.outputFileSync(to, file);
    } else {
        fse.outputFileSync(to, file);
        return Promise.resolve();
    }
};


const copyFileFromServerToBuild = (fullNamePath) => {
    return new Promise((resolve, reject) => {
        copyFilesWithFilters(fullNamePath.replace(CONSTANTS.SERVER__SRC_FOLDER, CONSTANTS.SERVER__BUILD_FOLDER), fullNamePath)
            .then(() => {
                resolve([fullNamePath]);
            })
            .catch(reject);

    });
};

const copyServerFilesFromSrcToBuild = (fullNamePath) => {
    let promise_ = (fullNamePath) ? copyFileFromServerToBuild(fullNamePath) : copyAllFileFromServerToBuild();
    promise_
    .then((files)=> {
        console.log(`${FILENAME}: static files copied! ${files.toString()}`);
        exec(`node scripts/request-refresh-browser-script.js`, (error, stdout, stderr) => {
            if (error) {
                console.log(`${FILENAME}: Error! ${error}`, stdout, stderr);
            }
        });
    })
    .catch(err => {
        console.log(`${FILENAME} ERROR: Something went wrong in makeConfigsWrapper` + "\r\n" + JSON.stringify(err, null, 4) + "\r\n");
    });
};

const deleteFilesInBuildServerFolder = (fullNamePath) => {
    fse.remove(fullNamePath.replace(CONSTANTS.SERVER__SRC_FOLDER, CONSTANTS.SERVER__BUILD_FOLDER)).then(() => {
        console.log(`${FILENAME}: files deleted! ${fullNamePath.toString()}`);
    });
};

const makeConfigs = () => {
    return new Promise((resolve, reject) => {
        exec(`node scripts/make-server-configs.js`, (error, stdout, stderr) => {
            if (error) {
                console.log(`${FILENAME}: Error! ${error}`, stdout, stderr);
                reject(error);
            } else {
                console.log(stdout, stderr);
                resolve();
            }
        });
    });
};

const getTCPResponse = (port, command, commandLine, domen) => {
    let domen_ = domen || 'localhost';
    return new Promise((resolve, reject) => {
        let client = new require('net').Socket();
        client.connect(port, domen_, () => {
            client.write(JSON.stringify({
                command: command,
                commandLine: commandLine
            }));
        });
        client.on('data', data => {
            client.destroy();
            resolve(data);
        });
        client.on('close', () => {
            client.destroy();
            reject('Server suddenly closed connection before sent data');
        });
        client.on('error', err => {
            client.destroy();
            reject(err);
        });
    });
};


const restartConcurrentlyWrapperProcess = (strCommand) => {
    return new Promise((resolve, reject) => {
        getTCPResponse(CONSTANTS.CONCURRENTLY_WRAPPER__PORT, 'getActiveProcessList', '')
        .then(data => {
            let message = JSON.parse(data.toString('utf-8'));
            for (let cmd in message) {
                if (!~cmd.indexOf(strCommand)) continue;
                new Promise((resolve, reject) => {
                    terminate(message[cmd].pid, 'SIGKILL', err => {
                        if (err) {
                            console.log(`${FILENAME} ERROR: Can't terminate process with pid ${message[cmd].pid}. Maybe this process not exist`);
                            console.log(`${FILENAME} ${JSON.stringify(err, null, 4) }\r\n`);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                })
                .then(() => {
                    getTCPResponse(CONSTANTS.CONCURRENTLY_WRAPPER__PORT, 'add', `add '${cmd}' ${message[cmd].index}`);
                })
                .catch(err => {
                    throw err;
                });
            }
        })
        .catch(err => {
            console.log(`${FILENAME} ERROR: Something went wrong in makeConfigsWrapper` + "\r\n" + JSON.stringify(err, null, 4) + "\r\n");
            reject(err);
        });
    });
};

options['scripts/make-server-configs.js'] = {
    callbacks: {
        any: () => {
            restartConcurrentlyWrapperProcess('ts-server');
        }
    }
};
options['scripts/make-client-configs.js'] = {
    callbacks: {
        any: () => {
            restartConcurrentlyWrapperProcess('webpack-client');
        }
    }
};
options[`${CONSTANTS.CONFIGS_SERVICES__DIR}/webpack-client.conf.js`] = {
    callbacks: {
        any: () => {
            restartConcurrentlyWrapperProcess('webpack-client');
        }
    }
};
options[CONSTANTS.SERVER__SRC_FOLDER] = {
    callbacks: {
        create: copyServerFilesFromSrcToBuild,
        change: copyServerFilesFromSrcToBuild,
        delete: deleteFilesInBuildServerFolder
    },
    runImmediately: copyServerFilesFromSrcToBuild,
    includeFile: function(fullNamePath) {
        let ext = fullNamePath.split('.').pop().toLowerCase();
        return ![
            'tsx',
            'crdownload'
        ].reduce((bool, extension) => {
            return extension === ext ? !!(++bool) : !!bool
        }, false);
    }
};
options[CONSTANTS.SERVER__SRC_TEST_FOLDER] = {
    callbacks: {
        any: function(fullNamePath) {
            console.log(`${FILENAME}: Change detected with ${fullNamePath}`);
            console.log(`${FILENAME}: run build server script...`);
            exec(`node scripts/build-server-script.js`, (error, stdout, stderr) => {
                if (error) {
                    console.log(`${FILENAME} ERROR:  ${error}`, stdout, stderr);
                } else {
                    console.log(`${FILENAME}: ${stdout}`, stderr);
                }
            });
        }
    },
    includeFile: function(fullNamePath) {
        return /[sS]pec\.[a-zA-Z]+$/.test(fullNamePath);
    }
};

module.exports = options;
