import { MongoClient }  from 'mongodb'
import { BaseAdapter }  from './base'
import assert           from 'assert'
import log4js           from 'log4js' 
import Q                from 'q'
import _                from 'lodash'
import { promisify }    from '../../utils/helpers'

const logger = log4js.getLogger();

export class MongoAdapter extends BaseAdapter {

    constructor(pocket, config) {
        super(pocket, config);

        const { url, dbName } = config;
        assert.ok(url, 'Mongodb url should be provided (cfg.url)');
        assert.ok(dbName, 'Mongodb database name should be provided (cfg.dbName)');

        this.url    = url;
        this.dbName = dbName;

        if (!/^mongodb:\/\//.test(this.url)) {
            this.url = "mongodb://" + this.url;
        }

        let deferred = Q.defer();
        
        this.client = new MongoClient(this.url, { useNewUrlParser: true });
        this.client.connect((err, client) => {
            assert.equal(null, err);

            logger.log(`Connection established to ${this.url}`);
            this.db = client.db(dbName);
            deferred.resolve(true);
        });

        this.initialization = deferred.promise;
    }

    setUniqueField(collection, fieldName) {
        const store = this.db.collection(collection);
        store.createIndex({ [fieldName] : 1 },  { unique: true });
    }

    async find(collection, query, opts = {}) {
        let store       = this.db.collection(collection);
        let transaction = store.find(query);

        if (_.isNumber(opts.skip)) {
            transaction = transaction.skip(opts.skip);
        }
        if (_.isNumber(opts.limit)) {
            transaction = transaction.limit(opts.limit);
        }

        return await transaction.toArray();
    }

    async insert (collection, payload) {
        let store   = this.db.collection(collection);
        let result  = await store.insertOne(payload);

        return result.ops[0];
    }

    async update (collection, query, operations, opts = {}) {
        const store         = this.db.collection(collection);
        const options       = _.extend({ returnUpdatedDocs: true, multi: true }, opts);

        if (options.multi) {
            const ids           = await this.find(collection, query).map(r => r._id);
            const matchesIds    = {_id: {$in: ids}};
            await store.updateMany(matchesIds, operations);
            return store.find(matchesIds).toArray();
        }

        const result = await store.findOneAndUpdate(query, operations, { returnOriginal: false });
        return result.value;
    }

    async remove (collection, query, options = { multi: true }) {
        let store   = this.db.collection(collection);
        let remove  = promisify(options.multi ? store.deleteMany : store.deleteOne, store);

        const result = await remove(query, options);
        return result.deletedCount;
    }

    async close() {
        this.client.close();
    }

    async ready () {
        return this.initialization;
    }
}

export default MongoAdapter;