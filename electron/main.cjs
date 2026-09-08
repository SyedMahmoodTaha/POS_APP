const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const XLSX = require("xlsx");
const {
    initializeDatabase,
    defaultCatalog,
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
} = require("./db-core.cjs");

const envPath = app.isPackaged ? path.join(process.resourcesPath, ".env") : path.join(__dirname, "../.env");
try {
    fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
    });
} catch {
}

const configuredAccounts = [
    { name: process.env.VITE_CASHIER_NAME, username: process.env.VITE_CASHIER_USERNAME, password: process.env.VITE_CASHIER_PASSWORD, role: "Cashier" },
    { name: process.env.VITE_ADMIN_NAME, username: process.env.VITE_ADMIN_USERNAME, password: process.env.VITE_ADMIN_PASSWORD, role: "Admin" },
];

const sharedUserDataDir = path.join(app.getPath("appData"), "Lassi Shop POS");
fs.mkdirSync(sharedUserDataDir, { recursive: true });
const originalUserData = app.getPath("userData");
if (originalUserData !== sharedUserDataDir) {
    app.setPath("userData", sharedUserDataDir);
    const legacyDb = path.join(originalUserData, "pfl.sqlite");
    const targetDb = path.join(sharedUserDataDir, "pfl.sqlite");
    if (fs.existsSync(legacyDb) && !fs.existsSync(targetDb)) {
        fs.copyFileSync(legacyDb, targetDb);
    }
}

const settingsPath = () => path.join(app.getPath("userData"), "printer-settings.json");
const usersPath = () => path.join(app.getPath("userData"), "users.json");
const readUsers = () => {
    try {
        const storedUsers = JSON.parse(fs.readFileSync(usersPath(), "utf8"));
        const configuredUsers = configuredAccounts.map((user) => {
            const override = storedUsers.find((stored) => stored.originalUsername === user.username || stored.username === user.username);
            return { ...user, ...override, originalUsername: override?.originalUsername || user.username };
        });
        return configuredUsers.concat(storedUsers.filter((stored) => !configuredAccounts.some((configured) => stored.originalUsername === configured.username || stored.username === configured.username)));
    } catch {
        return configuredAccounts;
    }
};
const writeUsers = (users) => {
    fs.writeFileSync(usersPath(), JSON.stringify(users, null, 2));
    return users;
};
const normalizePrinterSetting = (value) => {
    if (typeof value === "object" && value && value.host) {
        return {
            type: value.type === "ip" ? "ip" : "ip",
            host: String(value.host || "").trim(),
            port: Number(value.port || 9100),
        };
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return "";
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) {
            return { type: "ip", host: trimmed, port: 9100 };
        }
        return trimmed;
    }
    return "";
};

const defaultReceiptOptions = {
    logo: true,
    businessName: true,
    dateTime: true,
    billNumber: true,
    billType: true,
    cashierName: true,
    customerName: true,
    phone: true,
    address: true,
    deliveryCharges: true,
    parcelCharges: true,
    subtotal: true,
    itemPrice: true,
    total: true,
    discount: true,
    note: true,
    tableNumber: true,
    footer: true,
};

const defaultBillTemplates = [
    { id: "classic", name: "Classic 80mm", layout: "classic", paperWidth: 80, alignment: "center", businessName: "Lassi Shop", footerText: "Thank you for visiting us", headerText: "", fields: defaultReceiptOptions },
    { id: "minimal", name: "Minimal receipt", layout: "minimal", paperWidth: 80, alignment: "center", businessName: "Lassi Shop", footerText: "Thank you for visiting us", headerText: "", fields: { ...defaultReceiptOptions, logo: false, address: false, note: false, footer: false } },
    { id: "customer", name: "Customer details", layout: "customer", paperWidth: 80, alignment: "center", businessName: "Lassi Shop", footerText: "Thank you for visiting us", headerText: "Freshly prepared for you", fields: defaultReceiptOptions },
];

const normalizeReceiptOptions = (value = {}) => ({
    ...defaultReceiptOptions,
    ...(value && typeof value === "object" ? value : {}),
});

const normalizeBillTemplates = (value) => {
    if (!Array.isArray(value) || value.length === 0) return defaultBillTemplates;
    return value.map((template) => ({
        ...defaultBillTemplates[0],
        ...(template && typeof template === "object" ? template : {}),
        paperWidth: Number(template?.paperWidth) || 80,
        fields: normalizeReceiptOptions(template?.fields),
    }));
};

const readPrinterSettings = () => {
    try {
        const saved = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
        return {
            kitchen: normalizePrinterSetting(saved?.kitchen),
            cashier: normalizePrinterSetting(saved?.cashier),
            receiptOptions: normalizeReceiptOptions(saved?.receiptOptions || saved?.options),
            billTemplates: normalizeBillTemplates(saved?.billTemplates),
            selectedBillTemplateId: saved?.selectedBillTemplateId || "classic",
            selectedBillTemplateIds: saved?.selectedBillTemplateIds || { kitchen: saved?.selectedBillTemplateId || "classic", cashier: saved?.selectedBillTemplateId || "classic" },
            printCashierToKitchen: saved?.printCashierToKitchen === true,
        };
    } catch {
        return {
            kitchen: normalizePrinterSetting(process.env.PFL_KITCHEN_PRINTER || ""),
            cashier: normalizePrinterSetting(process.env.PFL_CASHIER_PRINTER || ""),
            receiptOptions: normalizeReceiptOptions(),
            billTemplates: defaultBillTemplates,
            selectedBillTemplateId: "classic",
            selectedBillTemplateIds: { kitchen: "classic", cashier: "classic" },
            printCashierToKitchen: false,
        };
    }
};

const resolvePrinterSetting = async (event, destination) => {
    const configured = readPrinterSettings()[destination];
    if (configured && (typeof configured === "string" ? configured.trim() : configured.host)) {
        return configured;
    }
    if (!event?.sender?.getPrintersAsync) return configured;
    try {
        const printers = await event.sender.getPrintersAsync();
        if (!printers?.length) return configured;
        const fallbackPrinter = printers[0]?.name || printers[0]?.displayName || "";
        return fallbackPrinter || configured;
    } catch {
        return configured;
    }
};

const writePrinterSettings = (settings) => {
    const current = readPrinterSettings();
    const normalized = {
        kitchen: normalizePrinterSetting(settings?.kitchen),
        cashier: normalizePrinterSetting(settings?.cashier),
        receiptOptions: normalizeReceiptOptions(settings?.receiptOptions || settings?.options),
        billTemplates: normalizeBillTemplates(settings?.billTemplates || current.billTemplates),
        selectedBillTemplateId: settings?.selectedBillTemplateId || current.selectedBillTemplateId || "classic",
        selectedBillTemplateIds: settings?.selectedBillTemplateIds || current.selectedBillTemplateIds || { kitchen: settings?.selectedBillTemplateId || "classic", cashier: settings?.selectedBillTemplateId || "classic" },
        printCashierToKitchen: settings?.printCashierToKitchen ?? current.printCashierToKitchen ?? false,
    };
    fs.writeFileSync(settingsPath(), JSON.stringify(normalized, null, 2));
    return normalized;
};

const createEscPosReceipt = (order, destination, template) => {
    const lines = [];
    const add = (line = "") => lines.push(line);
    const title = destination === "kitchen" ? "KITCHEN KOT" : "CASHIER BILL";
    add("\x1b\x40");
    add("\x1b\x61\x01");
    if (template?.businessName) add(template.businessName);
    if (template?.headerText) add(template.headerText);
    add(title);
    add("\x1b\x61\x00");
    const fields = template?.fields || defaultReceiptOptions;
    if (fields.billNumber) add(`Order: ${order.orderNumber}`);
    if (fields.billType) add(order.orderType === "Table" ? `Table: ${order.orderDetails?.tableNumber || "Unassigned"}` : order.orderType || "Unassigned");
    if (fields.dateTime) add(new Date(order.createdAt).toLocaleString());
    add("--------------------------------");
    order.cart.forEach((item) => {
        const amount = destination === "kitchen" ? "" : ` Rs ${Math.round(item.price * item.quantity)}`;
        add(`${item.quantity} x ${item.name}${amount}`);
        if (item.note) add(`  Note: ${item.note}`);
    });
    add("--------------------------------");
    if (fields.total) add(`TOTAL: Rs ${Math.round(order.total)}`);
    if (fields.note && order.orderNote) add(`Note: ${order.orderNote}`);
    if (fields.footer && template?.footerText) add(template.footerText);
    add("\n\n\n");
    add("\x1d\x56\x00");
    return Buffer.from(lines.join("\n"), "utf8");
};

const sendToNetworkPrinter = (printer, order, destination, template) => new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: printer.host, port: printer.port || 9100, timeout: 5000 });
    socket.on("connect", () => socket.end(createEscPosReceipt(order, destination, template), () => resolve({ printer: `${printer.host}:${printer.port || 9100}` })));
    socket.on("timeout", () => socket.destroy(new Error("Printer connection timed out")));
    socket.on("error", (error) => reject(new Error(`Could not connect to printer ${printer.host}:${printer.port || 9100}: ${error.message}`)));
});

const isIpAddress = (value) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);

const createWindow = () => {
    const window = new BrowserWindow({
        width: 1440,
        height: 960,
        show: false,
        backgroundColor: "#1f1f1f",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    window.once("ready-to-show", () => window.show());
    window.loadFile(path.join(__dirname, "../dist/index.html"));
    return window;
};

const createDbViewerWindow = () => {
    if (global.dbViewerWindow && !global.dbViewerWindow.isDestroyed()) {
        global.dbViewerWindow.show();
        global.dbViewerWindow.focus();
        return global.dbViewerWindow;
    }

    const dbViewerWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        backgroundColor: "#1f1f1f",
        title: "PFL SQLite Database Viewer",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    global.dbViewerWindow = dbViewerWindow;
    dbViewerWindow.once("ready-to-show", () => dbViewerWindow.show());
    dbViewerWindow.on("closed", () => {
        global.dbViewerWindow = null;
    });
    dbViewerWindow.loadFile(path.join(__dirname, "../dist/index.html"), { hash: "/sqlite-db-viewer" });
    return dbViewerWindow;
};

const printOrder = async (event, { html, order, destination }) => {
    const printer = await resolvePrinterSetting(event, destination);
    const networkPrinter = typeof printer === "object" && printer && printer.host
        ? { host: printer.host, port: Number(printer.port) || 9100 }
        : null;

    if (networkPrinter) {
        if (!networkPrinter.host) throw new Error(`No ${destination} printer IP configured.`);
        const savedSettings = readPrinterSettings();
        const templateId = savedSettings.selectedBillTemplateIds?.[destination] || savedSettings.selectedBillTemplateId;
        return sendToNetworkPrinter(networkPrinter, order, destination, savedSettings.billTemplates.find((template) => template.id === templateId));
    }

    let deviceName = typeof printer === "string" ? printer.trim() : "";
    if (!deviceName && event?.sender?.getPrintersAsync) {
        try {
            const printers = await event.sender.getPrintersAsync();
            deviceName = printers?.[0]?.name || printers?.[0]?.displayName || "";
        } catch {
            deviceName = "";
        }
    }

    if (!deviceName) {
        throw new Error(`No ${destination} printer is available. Connect a printer or configure one in Printer Settings.`);
    }

    const printWindow = new BrowserWindow({ show: false });
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    return new Promise((resolve, reject) => {
        const printOptions = { silent: true, deviceName };
        printWindow.webContents.print(printOptions, (success, failureReason) => {
            printWindow.close();
            if (!success) {
                reject(new Error(failureReason || `Could not print to the default ${destination} printer.`));
                return;
            }
            resolve({ printer: deviceName });
        });
    });
};

app.whenReady().then(() => {
    ipcMain.handle("pfl:authenticate", (event, { username, password }) => {
        const account = readUsers().find((candidate) => candidate.username === username && candidate.password === password);
        return account ? { name: account.name, username: account.username, role: account.role } : null;
    });
    ipcMain.handle("pfl:get-users", () => readUsers().map((user) => ({ name: user.name, username: user.username, password: user.password, role: user.role, originalUsername: user.originalUsername })));
    ipcMain.handle("pfl:set-users", (event, users) => writeUsers(users));
    ipcMain.handle("pfl:print-order", printOrder);
    ipcMain.handle("pfl:get-printers", async (event) => {
        try {
            return await event.sender.getPrintersAsync();
        } catch {
            return [];
        }
    });
    ipcMain.handle("pfl:get-printer-settings", async (event) => {
        const saved = readPrinterSettings();
        const kitchen = saved.kitchen || await resolvePrinterSetting(event, "kitchen");
        const cashier = saved.cashier || await resolvePrinterSetting(event, "cashier");
        return { kitchen, cashier, receiptOptions: saved.receiptOptions, billTemplates: saved.billTemplates, selectedBillTemplateId: saved.selectedBillTemplateId, selectedBillTemplateIds: saved.selectedBillTemplateIds, printCashierToKitchen: saved.printCashierToKitchen };
    });
    ipcMain.handle("pfl:set-printer-settings", (event, settings) => writePrinterSettings({
        kitchen: settings?.kitchen || "",
        cashier: settings?.cashier || "",
        receiptOptions: settings?.receiptOptions || settings?.options || {},
        billTemplates: settings?.billTemplates,
        selectedBillTemplateId: settings?.selectedBillTemplateId,
        selectedBillTemplateIds: settings?.selectedBillTemplateIds,
        printCashierToKitchen: settings?.printCashierToKitchen,
    }));
    ipcMain.handle("pfl:export-sales-report", async (event, payload = {}) => {
        try {
            const rows = Array.isArray(payload.orders) ? payload.orders : [];
            const workbook = XLSX.utils.book_new();
            const overviewSheet = XLSX.utils.json_to_sheet([
                { Metric: "Total Revenue", Value: rows.reduce((sum, order) => sum + Number(order.total || 0), 0) },
                { Metric: "Total Orders", Value: rows.length },
                { Metric: "Average Order Value", Value: rows.length ? rows.reduce((sum, order) => sum + Number(order.total || 0), 0) / rows.length : 0 },
            ]);
            XLSX.utils.book_append_sheet(workbook, overviewSheet, "Overview");

            const salesSheet = XLSX.utils.json_to_sheet(rows.map((order) => ({
                OrderNumber: order.orderNumber || "",
                CreatedAt: order.createdAt || "",
                OrderType: order.orderType || "Walk-in",
                Table: order.orderDetails?.tableNumber || order.table || "",
                Status: order.status || "saved",
                Total: Number(order.total || 0),
            })));
            XLSX.utils.book_append_sheet(workbook, salesSheet, "Recent Orders");

            const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
            const { canceled, filePath } = await dialog.showSaveDialog({
                title: "Export sales report",
                defaultPath: path.join(app.getPath("downloads"), "pfl-sales-report.xlsx"),
                filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
            });

            if (canceled || !filePath) {
                return { ok: false, canceled: true };
            }

            fs.writeFileSync(filePath, buffer);
            return { ok: true, filePath };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle("pfl:get-catalog", () => getCatalogFromDb(app));
    ipcMain.handle("pfl:save-catalog", (event, catalog) => saveCatalogToDb(app, catalog));
    ipcMain.handle("pfl:get-tables", () => getTableNamesFromDb(app));
    ipcMain.handle("pfl:save-tables", (event, tables) => saveTablesToDb(app, tables));
    ipcMain.handle("pfl:get-orders", () => getOrdersFromDb(app));
    ipcMain.handle("pfl:save-orders", (event, orders) => saveOrdersToDb(app, orders));
    ipcMain.handle("pfl:prepare-clean-windows-data", () => prepareCleanWindowsData(app));
    ipcMain.handle("pfl:open-db-viewer-window", () => createDbViewerWindow());
    ipcMain.handle("pfl:get-db-tables", () => listDbTables(app));
    ipcMain.handle("pfl:get-db-table", (event, tableName) => getDbTableData(app, tableName));
    ipcMain.handle("pfl:insert-db-row", (event, payload) => {
        try {
            return insertDbRow(app, payload || {});
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle("pfl:update-db-row", (event, payload) => {
        try {
            return updateDbRow(app, payload || {});
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle("pfl:delete-db-row", (event, payload) => {
        try {
            return deleteDbRow(app, payload || {});
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    initializeDatabase(app);
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});