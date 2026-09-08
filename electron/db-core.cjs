const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { categories: seededCategories, menuItems: seededMenuItems } = require("./menu-seed.cjs");

const defaultCatalog = {
    categories: seededCategories,
    menuItems: seededMenuItems,
};

const getDataDirectory = (app) => {
    const sharedDir = path.join(app.getPath("appData"), "Lassi Shop POS");
    const originalUserData = app.getPath("userData");

    fs.mkdirSync(sharedDir, { recursive: true });
    if (originalUserData !== sharedDir) {
        app.setPath("userData", sharedDir);
        const legacyDb = path.join(originalUserData, "pfl.sqlite");
        const targetDb = path.join(sharedDir, "pfl.sqlite");
        if (fs.existsSync(legacyDb) && !fs.existsSync(targetDb)) {
            fs.copyFileSync(legacyDb, targetDb);
        }
    }

    return app.getPath("userData");
};
const dbPath = (app) => path.join(getDataDirectory(app), "pfl.sqlite");
let sqliteDb = null;

const normalizeIdentifier = (value) => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : "";
};

const initializeDatabase = (app) => {
    if (sqliteDb) return sqliteDb;
    sqliteDb = new Database(dbPath(app), { fileMustExist: false });
    sqliteDb.pragma("journal_mode = WAL");
    sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT,
            name TEXT,
            category TEXT,
            price REAL,
            diet TEXT,
            favorite INTEGER DEFAULT 0,
            variations TEXT DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            username TEXT NOT NULL UNIQUE,
            password TEXT,
            role TEXT
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payload TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);
    
    // Populate default data if tables are empty
    const itemCount = sqliteDb.prepare("SELECT COUNT(*) as count FROM items").get().count;
    if (itemCount === 0) {
        const insertCategory = sqliteDb.prepare("INSERT INTO categories (name) VALUES (?)");
        const insertMany = sqliteDb.transaction((rows) => rows.forEach((row) => insertCategory.run(row)));
        insertMany(defaultCatalog.categories);

        const insertItem = sqliteDb.prepare("INSERT INTO items (code, name, category, price, diet, favorite, variations) VALUES (?, ?, ?, ?, ?, ?, ?)");
        const insertItems = sqliteDb.transaction((rows) => rows.forEach((row) => insertItem.run(
            row.code ?? "",
            row.name ?? "",
            row.category ?? "",
            Number(row.price || 0),
            row.diet ?? "veg",
            row.favorite ? 1 : 0,
            JSON.stringify(row.variations || [])
        )));
        insertItems(defaultCatalog.menuItems);

        const insertTable = sqliteDb.prepare("INSERT INTO tables (name) VALUES (?)");
        const insertTables = sqliteDb.transaction((rows) => rows.forEach((row) => insertTable.run(row)));
        insertTables(["R1", "R2", "R3", "L1", "L2", "L3", "L4", "F1", "F2", "F3", "F4", "F5", "F6"]);
    }
    
    return sqliteDb;
};

const listDbTables = (app) => {
    const db = initializeDatabase(app);
    return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
};

const getCatalogFromDb = (app) => {
    const db = initializeDatabase(app);
    const categories = db.prepare("SELECT name FROM categories ORDER BY name").all().map((row) => row.name);
    const menuItems = db.prepare("SELECT * FROM items ORDER BY id").all().map((item) => ({
        ...item,
        id: Number(item.id),
        price: Number(item.price || 0),
        favorite: Boolean(item.favorite),
        variations: (() => {
            try {
                return JSON.parse(item.variations || "[]");
            } catch {
                return [];
            }
        })(),
    }));

    return { categories: categories.length ? categories : defaultCatalog.categories, menuItems: menuItems.length ? menuItems : defaultCatalog.menuItems };
};

const saveCatalogToDb = (app, catalog) => {
    const db = initializeDatabase(app);
    const safeCategories = Array.isArray(catalog?.categories) ? catalog.categories : [];
    const safeMenuItems = Array.isArray(catalog?.menuItems) ? catalog.menuItems : [];

    db.prepare("DELETE FROM categories").run();
    if (safeCategories.length) {
        const insertCategory = db.prepare("INSERT INTO categories (name) VALUES (?)");
        const insertMany = db.transaction((rows) => rows.forEach((row) => insertCategory.run(row)));
        insertMany(safeCategories);
    }

    db.prepare("DELETE FROM items").run();
    if (safeMenuItems.length) {
        const insertItem = db.prepare("INSERT INTO items (code, name, category, price, diet, favorite, variations) VALUES (?, ?, ?, ?, ?, ?, ?)");
        const insertMany = db.transaction((rows) => rows.forEach((row) => insertItem.run(
            row.code ?? "",
            row.name ?? "",
            row.category ?? "",
            Number(row.price || 0),
            row.diet ?? "veg",
            row.favorite ? 1 : 0,
            JSON.stringify(row.variations || [])
        )));
        insertMany(safeMenuItems);
    }

    return getCatalogFromDb(app);
};

const getTableNamesFromDb = (app) => {
    const db = initializeDatabase(app);
    return db.prepare("SELECT name FROM tables ORDER BY name").all().map((row) => row.name);
};

const saveTablesToDb = (app, tables) => {
    const db = initializeDatabase(app);
    const nextTables = Array.isArray(tables) ? tables : [];
    db.prepare("DELETE FROM tables").run();
    if (nextTables.length) {
        const insertTable = db.prepare("INSERT INTO tables (name) VALUES (?)");
        const insertMany = db.transaction((rows) => rows.forEach((row) => insertTable.run(row)));
        insertMany(nextTables);
    }
    return nextTables;
};

const getOrdersFromDb = (app) => {
    const db = initializeDatabase(app);
    const rows = db.prepare("SELECT id, payload FROM orders ORDER BY id DESC").all();
    return rows
        .map((row) => {
            if (!row.payload) return null;
            try {
                const payload = JSON.parse(row.payload);
                return payload && typeof payload === "object" ? payload : null;
            } catch {
                return null;
            }
        })
        .filter(Boolean);
};

const saveOrdersToDb = (app, orders) => {
    const db = initializeDatabase(app);
    const nextOrders = Array.isArray(orders) ? orders : [];
    db.prepare("DELETE FROM orders").run();
    if (nextOrders.length) {
        const insertOrder = db.prepare("INSERT INTO orders (payload) VALUES (?)");
        const insertMany = db.transaction((rows) => rows.forEach((row) => insertOrder.run(JSON.stringify(row))));
        insertMany(nextOrders);
    }
    return nextOrders;
};

const prepareCleanWindowsData = (app) => {
    if (process.platform !== "win32") return false;
    const dataDirectory = getDataDirectory(app);
    const markerPath = path.join(dataDirectory, ".clean-sales-initialized");
    if (fs.existsSync(markerPath)) return false;
    initializeDatabase(app).prepare("DELETE FROM orders").run();
    fs.writeFileSync(markerPath, new Date().toISOString());
    return true;
};

const getDbTableData = (app, tableName) => {
    const safeTable = normalizeIdentifier(tableName);
    if (!safeTable) throw new Error("Invalid table name");
    const db = initializeDatabase(app);
    const columns = db.prepare(`PRAGMA table_info("${safeTable}")`).all();
    const rows = db.prepare(`SELECT * FROM "${safeTable}" ORDER BY 1`).all();
    return {
        columns: columns.map((column) => ({ name: column.name, type: column.type, notnull: !!column.notnull, pk: !!column.pk })),
        rows,
    };
};

const insertDbRow = (app, { tableName, row = {} }) => {
    const safeTable = normalizeIdentifier(tableName);
    if (!safeTable) throw new Error("Invalid table name");
    const columns = Object.keys(row || {}).filter((column) => normalizeIdentifier(column));
    if (!columns.length) throw new Error("No columns provided");
    const db = initializeDatabase(app);
    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT INTO "${safeTable}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${placeholders})`;
    const info = db.prepare(sql).run(...columns.map((column) => row[column]));
    return { ok: true, lastInsertId: info.lastInsertRowid };
};

const updateDbRow = (app, { tableName, idColumn, idValue, row = {} }) => {
    const safeTable = normalizeIdentifier(tableName);
    const safeIdColumn = normalizeIdentifier(idColumn);
    if (!safeTable || !safeIdColumn) throw new Error("Invalid table or id column");
    const columns = Object.keys(row || {}).filter((column) => normalizeIdentifier(column));
    if (!columns.length) throw new Error("No columns provided");
    const db = initializeDatabase(app);
    const assignments = columns.map((column) => `"${column}" = ?`).join(", ");
    const sql = `UPDATE "${safeTable}" SET ${assignments} WHERE "${safeIdColumn}" = ?`;
    const info = db.prepare(sql).run(...columns.map((column) => row[column]), idValue);
    return { ok: true, changes: info.changes };
};

const deleteDbRow = (app, { tableName, idColumn, idValue }) => {
    const safeTable = normalizeIdentifier(tableName);
    const safeIdColumn = normalizeIdentifier(idColumn);
    if (!safeTable || !safeIdColumn) throw new Error("Invalid table or id column");
    const db = initializeDatabase(app);
    const info = db.prepare(`DELETE FROM "${safeTable}" WHERE "${safeIdColumn}" = ?`).run(idValue);
    return { ok: true, changes: info.changes };
};

module.exports = {
    dbPath,
    defaultCatalog,
    initializeDatabase,
    listDbTables,
    getCatalogFromDb,
    saveCatalogToDb,
    getTableNamesFromDb,
    saveTablesToDb,
    getOrdersFromDb,
    saveOrdersToDb,
    prepareCleanWindowsData,
    getDbTableData,
    insertDbRow,
    updateDbRow,
    deleteDbRow,
};
