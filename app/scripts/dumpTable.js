var sqlite3 = require('sqlite3').verbose();

var db = new sqlite3.Database('accessTokens.db');

db.serialize(function () {
    db.each("SELECT username, token FROM tokens", function(err, row) {
        console.log(row.username + ": " + row.token);
    });
});

db.close();
