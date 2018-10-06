import path             from 'path'
import fs               from 'fs'
import _                from 'lodash'
import Q                from 'q'
import uuid             from 'uuid/v1'
import { promisify }    from '../../utils/helpers';
import mkdirp           from 'mkdirp'
import { 
    MAGIC_MIME_TYPE,
    Magic }        from 'mmmagic'

/**
 * 
 * 
 * @export
 * @class LocalFileStore
 */
export class LocalFileStore {

    /**
     * Creates an instance of LocalFileStore.
     * 
     * @param {String} uploadFolder 
     * @memberof LocalFileStore
     */
    constructor(uploadFolder) {
        this.uploadFolder = uploadFolder;
        if (!fs.existsSync(this.uploadFolder)) {
            mkdirp.sync(this.uploadFolder);
        }
    }

    // ---- Helpers

    _stampFilename(name) {
        return `${uuid()}-${name}`;
    }

    _isStream(stream) {
        return stream != null
            && _.isObject(stream)
            && _.isFunction(stream.pipe);
    }

    _getMetadata(file) {
        const filePath  = path.join(this.uploadFolder, file);
        const magic = new Magic(MAGIC_MIME_TYPE);
        const getMimeType = promisify(magic.detectFile, magic);
        const getStats = promisify(fs.stat, fs);

        return Q.all([
            getMimeType(filePath),
            getStats(filePath)
        ])
        .then(([mimeType, { size }]) => {
            let createdAt = _.now();
            return { file, mimeType, size, createdAt };
        });
    }

    // ---- API

    /**
     * 
     * 
     * @param {String} filename 
     * @param {Stream} istream 
     * @memberof LocalFileStore
     */
    saveStream(filename, istream) {
        return Q.Promise((resolve, reject) => {
            let outputFilename  = this._stampFilename(filename);
            let outputFilepath  = path.join(this.uploadFolder, outputFilename);
            let ostream         = fs.createWriteStream(outputFilepath);

            istream.pipe(ostream);
            ostream.on('finish', () => {
                this._getMetadata(outputFilename)
                    .then(resolve)
                    .catch(reject);
            });
            istream.on('error', reject);
        });
    }

    /**
     * 
     * 
     * @param {String} filename 
     * @param {String} filepath 
     * @memberof LocalFileStore
     */
    saveFile(filename, filepath) {
        try {
            let istream = fs.createReadStream(filepath);
            return this.saveStream(filename, istream);
        } catch (e) {
            return Q.reject(e);
        }
    }

    /**
     * 
     * @param {String} filename 
     * @param {String|Stream} streamOrFile 
     */
    save(filename, streamOrFile) {
        if (_.isString(streamOrFile)) {
            return this.saveFile(filename, streamOrFile);
        }
        if (this._isStream(streamOrFile)) {
            return this.saveStream(filename, streamOrFile);
        }
        return Q.reject("Bad stream or file");
    }

    /**
     * 
     * 
     * @param {String} filename 
     * @returns {Stream}
     * @memberof LocalFileStore
     */
    stream(filename) {
        let filepath  = path.join(this.uploadFolder, filename);
        return fs.createReadStream(filepath);
    }

    /**
     * 
     * 
     * @param {any} filename 
     * @memberof LocalFileStore
     */
    delete(filename) {
        return Q.Promise((resolve, reject) => {
            fs.unlink(path.join(this.uploadFolder, filename), (err) => {
                if (err) {
                    return reject(err)
                }
                resolve();
            });
        });
    }

}