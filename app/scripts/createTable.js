var sqlite3 = require('sqlite3').verbose();

var db = new sqlite3.Database('accessTokens.db');

console.log('Creating DB...');

db.serialize(function () {
    db.run('CREATE TABLE tokens (username TEXT, token TEXT)');
});

db.close();
