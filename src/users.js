const crypto               = require("./utils/crypto")
const Q                    = require("q")
const _                    = require("lodash")
const jwt                  = require("jsonwebtoken")
const config               = require("./utils/config")
const Schema               = require('./schema')
const {
    INVALID_USER_GROUP,
    INVALID_USERNAME_PW,
    SESSION_EXPIRED,
    USERNAME_TAKEN,
    UNAUTHORIZED,
    INTERNAL_ERROR }   = require("./utils/errors")


class User {

    constructor(userManager, config) {
        this.config             = config;
        this.userManager        = userManager;
        this.resource           = userManager.resource;
        this.id                 = null;
        this.hash               = null;
        this.username           = null;
        this.groups             = null;
        this.permissions        = null;
    }

    toPlainObject() {
        return {
            id:             this.id,
            username:       this.username,
            groups:         this.groups,
            permissions:    this.permissions
        };
    }

    jwt() {
        const secret = this.config.session.secret;
        const payload = _.extend({}, this.toPlainObject(), { timestamp: _.now() });
        return jwt.sign(payload, secret, {
            expiresIn: config.session.expiresIn
        });
    }

    async save() {
        for (let res in this.permissions) {
            this.permissions[res] = this.permissions[res].map(action => action.toLowerCase());
        }

        const json = {
            hash:           this.hash,
            username:       this.username,
            groups:         this.groups,
            permissions:    this.permissions
        }
        if (this.id) {
            return this.resource.mergeOne(this.id, json);
        }
        const record = await this.resource.create(json)
        this.id = record._id;
        return this;
    }

    isAllowed(action, resourceName) {
        action = action.toLowerCase();
        return !!_.find([ "*", resourceName ], (key) => {
            const allowedActions = this.permissions[key] || [];
            return _.find(allowedActions, (it) => it === action);
        });
    }

    isAdmin() {
        return this.userManager.isAdmin(this);
    }
}

class UserManager {

    constructor(pocket) {
        this.pocket     = pocket;
        this.config     = pocket.config();
        this.schema     = new Schema({
            "username": "string",
            "password": "password",
            "groups": {
                "type": "array",
                "items": {
                    "type": "string"
                }
            },
            "hash": "string",
            "userData": "object",
            "permissions": {
                "type": "map",
                "items": {
                    "type": "array",
                    "items": { "type" : "string" }
                }
            }
        })
        // .after('read', async ({ records, opts = {} }) => {
        //     if (!opts.rawObject) {
        //         _.each(records, r => {
        //             delete r.hash;
        //             delete r.password;
        //         });
        //     }
        // })
        // .before('save', async ({ record }) => {
        //     if (record.password) {
        //         record.hash = await crypto.hash(record.password);
        //     }
        //     delete payload.password;
            
        // });

        this.resource   = pocket.resource("_users", this.schema);
        this.ENFORCE_VALID_GROUP = false;
    }

    get Groups() {
        return {
            ADMINS: "admins",
            USERS:  "users"
        }
    }

    get AdminGroups() {
        return [
            this.Groups.ADMINS
        ]
    }

    // ---- METHODS

    hashPassword(password) {
        return crypto.hash(password)
    }

    /**
     * Tries to load an existing user
     *
     * @param {*} username
     * @param {*} password
     */
    async auth(username, password) {
        const userRecord = await this.resource.findOne({ username : username });
        if (!userRecord) throw INVALID_USERNAME_PW;

        const valid = await crypto.compare(password, userRecord.hash);
        if (!valid) throw INVALID_USERNAME_PW;

        let user            = new User(this, this.config);
        user.username       = userRecord.username;
        user.groups         = userRecord.groups;
        user.hash           = userRecord.hash;
        user.permissions    = userRecord.permissions;
        user.id             = userRecord._id;

        return user;
    }

    /**
     * Creates a new user (does not save it)
     *
     * @param {*} username
     * @param {*} password
     * @param {*} groups
     * @returns {User} a new user
     */
    async create(username, password, groups = [ "users" ], permissions = {}) {
        if (_.isString(groups)) {
            groups = [ groups ];
        }

        if (this.ENFORCE_VALID_GROUP) {
            for (let group of groups) {
                if (!_.find(_.values(this.Groups), (g) => g === group)) {
                    throw INVALID_USER_GROUP;
                }
            }
        }

        const existing = await this.resource.findOne({ username : username });
        if (existing) {
            throw USERNAME_TAKEN;
        }

        let user            = new User(this, this.config);
        user.username       = username;
        user.groups         = groups;
        user.permissions    = permissions;
        user.hash           = await this.hashPassword(password);

        return user.save();
    }

    /**
     * Create a User from the db object
     * @param {*} record
     */
    fromRecord(record) {
        let user            = new User(this, this.config);
        user.id             = record._id;
        user.groups         = record.groups;
        user.username       = record.username;
        user.permissions    = record.permissions;
        user.hash           = record.hash;
        return user;
    }

    /**
     * Returns the list of admins
     *
     * @memberof UserManager
     */
    async getAdmins() {
        let records = await this.resource.find({ groups: { $elemMatch: this.Groups.ADMINS }});
        return records.map((record) => this.fromRecord(record));
    }

    /**
     * Checks if a group has admin rights
     *
     * @static
     * @param {any} user
     * @returns
     * @memberof UserManager
     */
    isAdminGroup(group) {
        return this.AdminGroups.indexOf(group) >= 0;
    }

    /**
     * Checks if a group has admin rights
     *
     * @static
     * @param {any} group
     * @returns
     * @memberof UserManager
     */
    isAdmin(user) {
        return !!_.find(user.groups, (g) => this.isAdminGroup(g));
    }

    /**
     * Returns the user associated with the JWT or null
     *
     * @static
     * @param {*} token
     * @memberof UserManager
     */
    fromJWT(token) {
        const deferred = Q.defer();
        const secret = config.session.secret;

        jwt.verify(token, secret, (err, decoded = {}) => {
            if (err) {
                if (err.name === "TokenExpiredError") {
                    return deferred.reject(SESSION_EXPIRED);
                }
                return deferred.reject(UNAUTHORIZED);
            }

            let uid = decoded.id;
            if (!uid) {
                return deferred.reject(UNAUTHORIZED);
            }

            this.resource.get(uid)
                .then((user) => {
                    if (user) {
                        return deferred.resolve(this.fromRecord(user));
                    }
                    deferred.reject(UNAUTHORIZED);
                })
                .catch(() =>  {
                    deferred.reject(INTERNAL_ERROR)
                });
        });

        return deferred.promise;
    }
}

module.exports = { User, UserManager };