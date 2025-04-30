const { MongoClient} = require('mongodb');

const url = process.env.DB_URL;
let conDB = new MongoClient(url).connect()

module.exports = conDB