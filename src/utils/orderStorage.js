import { getCurrentUser } from "./auth";
import { defaultBillTemplates, readLocalBillTemplates } from "./billTemplates";

export const ORDERS_STORAGE_KEY = "pfl-orders-v2";
const LEGACY_ORDERS_STORAGE_KEY = "pfl-orders";
const BILL_SEQUENCE_STORAGE_KEY = "pfl-bill-sequence-v2";

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

const getBusinessDate = (date = new Date()) => {
    const businessDate = new Date(date);
    if (businessDate.getHours() < 3) businessDate.setDate(businessDate.getDate() - 1);
    return [businessDate.getFullYear(), businessDate.getMonth() + 1, businessDate.getDate()]
        .map((part) => String(part).padStart(2, "0"))
        .join("-");
};

export const getNextBillNumber = () => {
    const businessDate = getBusinessDate();
    let sequence = { date: businessDate, number: 0 };
    try {
        sequence = JSON.parse(localStorage.getItem(BILL_SEQUENCE_STORAGE_KEY)) || sequence;
    } catch {
    }
    const nextNumber = sequence.date === businessDate ? sequence.number + 1 : 1;
    localStorage.setItem(BILL_SEQUENCE_STORAGE_KEY, JSON.stringify({ date: businessDate, number: nextNumber }));
    return String(nextNumber).padStart(3, "0");
};

export const readOrders = () => {
    localStorage.removeItem(LEGACY_ORDERS_STORAGE_KEY);
    try {
        return JSON.parse(localStorage.getItem(ORDERS_STORAGE_KEY)) || [];
    } catch {
        return [];
    }
};

const persistOrdersToDb = async (orders) => {
    if (!window.pflDesktop || !window.pflDesktop.saveOrders) return;
    try {
        await window.pflDesktop.saveOrders(orders);
    } catch (error) {
        console.error("Could not save orders to SQLite:", error);
    }
};

export const hydrateOrdersFromDb = async () => {
    if (!window.pflDesktop || !window.pflDesktop.getOrders) return readOrders();
    try {
        const dbOrders = await window.pflDesktop.getOrders();
        if (Array.isArray(dbOrders) && dbOrders.length > 0) {
            localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(dbOrders));
            window.dispatchEvent(new Event("pfl-orders-updated"));
            return dbOrders;
        }
    } catch (error) {
        console.error("Could not load orders from SQLite:", error);
    }
    return readOrders();
};

export const appendOrder = (order) => {
    const orders = [order, ...readOrders()];
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
    if (window.pflDesktop && window.pflDesktop.saveOrders) {
        void persistOrdersToDb(orders);
    }
    window.dispatchEvent(new Event("pfl-orders-updated"));
    return order;
};

export const updateOrder = (orderId, changes) => {
    const orders = readOrders().map((order) => order.id === orderId ? { ...order, ...changes } : order);
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
    if (window.pflDesktop && window.pflDesktop.saveOrders) {
        void persistOrdersToDb(orders);
    }
    window.dispatchEvent(new Event("pfl-orders-updated"));
    return orders.find((order) => order.id === orderId);
};

export const removeOrder = (orderId) => {
    const orders = readOrders();
    const removedOrder = orders.find((order) => order.id === orderId);
    const remainingOrders = orders.filter((order) => order.id !== orderId);
    if (removedOrder?.orderType === "Table" && removedOrder.temporaryTable) {
        const tableName = removedOrder.orderDetails?.tableNumber;
        const isStillUsed = remainingOrders.some((order) => order.orderType === "Table" && order.orderDetails?.tableNumber === tableName);
        if (tableName && !isStillUsed) {
            const storedTables = localStorage.getItem("pfl-tables-v1");
            if (storedTables && localStorage.getItem("pfl-tables-initialized-v1")) {
                const permanentTables = JSON.parse(storedTables);
                localStorage.setItem("pfl-tables-v1", JSON.stringify(permanentTables.filter((table) => table !== tableName)));
                window.dispatchEvent(new Event("pfl-catalog-updated"));
            }
        }
    }
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(remainingOrders));
    if (window.pflDesktop && window.pflDesktop.saveOrders) {
        void persistOrdersToDb(remainingOrders);
    }
    window.dispatchEvent(new Event("pfl-orders-updated"));
};

export const resetOrderData = () => {
    localStorage.removeItem(ORDERS_STORAGE_KEY);
    localStorage.removeItem(BILL_SEQUENCE_STORAGE_KEY);
    if (window.pflDesktop && window.pflDesktop.saveOrders) {
        void persistOrdersToDb([]);
    }
    window.dispatchEvent(new Event("pfl-orders-updated"));
};

export const resetBillSequence = () => {
    localStorage.removeItem(BILL_SEQUENCE_STORAGE_KEY);
    window.dispatchEvent(new Event("pfl-orders-updated"));
};

const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const renderReceiptHtml = (order, destination, configuredOptions = {}) => {
    const template = configuredOptions?.fields ? configuredOptions : defaultBillTemplates[0];
    const options = { ...defaultReceiptOptions, ...(template.fields || configuredOptions) };
    const title = destination === "kitchen" ? "Kitchen KOT" : "";
    const currentUser = getCurrentUser();
    const cashierName = currentUser?.name || order.cashier || "Captain";
    const deliveryCharge = Number(order.charges?.Delivery || order.deliveryCharge || 0);
    const parcelCharge = Number(order.charges?.Parcel || order.parcelCharge || 0);
    const discount = Number(order.discount || 0);
    const customerName = order.orderDetails?.customerName || order.customerName || "";
    const phone = order.orderDetails?.phone || order.phone || "";
    const address = order.orderDetails?.address || order.address || "";
    const tableNumber = order.orderDetails?.tableNumber || order.tableNumber || "";
    const items = order.cart.map((item) => `
        <tr><td>${escapeHtml(item.name)}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</td><td>${item.quantity}</td>${options.itemPrice ? `<td>₹${Math.round(item.price * item.quantity)}</td>` : ""}</tr>
    `).join("");
    const logoSrc = new URL(`${import.meta.env.BASE_URL}Logo.png`, window.location.href).href;
    const fieldMarkup = {
        items: `<table><thead><tr><th>Item</th><th>Qty</th>${options.itemPrice ? "<th>Amount</th>" : ""}</tr></thead><tbody>${items}</tbody></table>`,
        billNumber: `<div class="meta-row"><span>Bill no</span><strong>${escapeHtml(order.orderNumber || "-")}</strong></div>`,
        billType: `<div class="meta-row"><span>Type</span><strong>${escapeHtml(order.orderType || "Walk-in")}</strong></div>`,
        tableNumber: tableNumber ? `<div class="meta-row"><span>Table</span><strong>${escapeHtml(tableNumber)}</strong></div>` : "",
        customerName: customerName ? `<div class="meta-row"><span>Customer</span><strong>${escapeHtml(customerName)}</strong></div>` : "",
        phone: phone ? `<div class="meta-row"><span>Phone</span><strong>${escapeHtml(phone)}</strong></div>` : "",
        address: address ? `<div class="meta-row"><span>Address</span><strong>${escapeHtml(address)}</strong></div>` : "",
        cashierName: `<div class="meta-row"><span>Captain</span><strong>${escapeHtml(cashierName)}</strong></div>`,
        dateTime: `<div class="meta-row"><span>Date</span><strong>${new Date(order.createdAt).toLocaleString()}</strong></div>`,
        subtotal: `<p class="row"><span>Subtotal</span><span>₹${Math.round(order.subtotal || order.total || 0)}</span></p>`,
        deliveryCharges: deliveryCharge > 0 ? `<p class="row"><span>Delivery</span><span>₹${Math.round(deliveryCharge)}</span></p>` : "",
        parcelCharges: parcelCharge > 0 ? `<p class="row"><span>Parcel</span><span>₹${Math.round(parcelCharge)}</span></p>` : "",
        discount: discount > 0 ? `<p class="row"><span>Discount</span><span>-₹${Math.round(discount)}</span></p>` : "",
        note: order.orderNote ? `<p class="note">Note: ${escapeHtml(order.orderNote)}</p>` : "",
        total: `<p class="total">Total: ₹${Math.round(order.total)}</p>`,
        footer: `<p class="footer">${escapeHtml(template.footerText || "Thank you for visiting us")}</p>`,
    };
    (template.dividers || []).forEach((divider) => {
        fieldMarkup[`divider:${divider.id}`] = `<div class="divider">${escapeHtml(divider.label || "")}</div>`;
    });
    const fieldOrder = template.fieldOrder || Object.keys(fieldMarkup);
    const orderedFields = fieldOrder.filter((field) => (field.startsWith("divider:") || options[field]) && fieldMarkup[field]);
    const bodyMarkup = orderedFields.map((field) => fieldMarkup[field]).join("");

    const paperWidth = template.paperWidth === 58 ? 58 : 80;
    const alignment = template.alignment || "center";
    const layoutClass = template.layout || "classic";
    return `<!doctype html><html><head><title>${title || "Receipt"}</title><style>
        @page { size: ${paperWidth}mm auto; margin: 0; }
        html, body { width: ${paperWidth}mm; max-width: ${paperWidth}mm; margin: 0; padding: 0; }
        body { font: 11px monospace; color: #111; padding: 8px; box-sizing: border-box; }
        .header { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 8px; }
        .logo-box { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; }
        .logo-box img { width: 100%; height: 100%; object-fit: contain; }
        .brand { font-size: 16px; font-weight: bold; text-align: ${alignment}; }
        .header-line { border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 6px 0; margin: 6px 0; }
        h1 { text-align: center; font-size: 14px; margin: 0; }
        p { margin: 4px 0; }
        .row { display: flex; justify-content: space-between; gap: 8px; }
        .meta-box { margin: 8px 0; }
        .meta-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin: 4px 0; }
        .meta-row span { color: #333; }
        .meta-row strong { text-align: right; max-width: 48%; font-weight: 700; word-break: break-word; }
        table { border-collapse: collapse; width: 100%; margin-top: 12px; }
        th, td { padding: 5px 0; text-align: left; border-bottom: 1px dashed #999; vertical-align: top; }
        th:nth-child(2), td:nth-child(2) { text-align: center; width: 18%; }
        th:last-child, td:last-child { text-align: right; width: 26%; }
        small { display: block; margin-top: 2px; color: #555; word-break: break-word; }
        .total { font-weight: bold; text-align: right; margin-top: 12px; font-size: ${layoutClass === "minimal" ? "13px" : "14px"}; }
        .note { margin-top: 12px; border-top: 1px dashed #999; padding-top: 8px; }
        .divider { display: flex; align-items: center; gap: 6px; margin: 10px 0; color: #555; font-size: 10px; text-align: center; }
        .divider::before, .divider::after { content: ""; flex: 1; border-top: 1px dashed #999; }
        .footer { text-align: center; margin-top: 12px; font-size: 11px; }
        @media print { body { margin: 0; } }
    </style></head><body>${options.logo || options.businessName ? `<div class="header">${options.logo ? `<div class="logo-box"><img src="${logoSrc}" alt="Logo" /></div>` : ""}${options.businessName ? `<div class="brand">${escapeHtml(template.businessName || "Lassi Shop")}</div>` : ""}</div>` : ""}${template.headerText ? `<p class="footer">${escapeHtml(template.headerText)}</p>` : ""}${title ? `<div class="header-line"><h1>${title}</h1></div>` : ""}<div class="meta-box">${bodyMarkup}</div></body></html>`;
};

const printSingleOrder = async (order, destination, selectedTemplate) => {
    const html = renderReceiptHtml(order, destination, selectedTemplate || defaultBillTemplates[0]);
    if (window.pflDesktop) {
        await window.pflDesktop.printOrder({ html, order, destination });
        return true;
    }

    const printWindow = window.open("", "_blank", "width=420,height=720");
    if (!printWindow) return false;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onafterprint = () => printWindow.close();
    printWindow.print();
    return true;
};

export const printOrder = async (order, destination) => {
    let settings = null;
    let templates = defaultBillTemplates;
    if (window.pflDesktop && window.pflDesktop.getPrinterSettings) {
        try {
            settings = await window.pflDesktop.getPrinterSettings();
            templates = settings?.billTemplates || defaultBillTemplates;
        } catch {
            settings = null;
        }
    } else {
        templates = readLocalBillTemplates();
    }

    const destinations = destination === "cashier" && settings?.printCashierToKitchen
        ? ["cashier", "kitchen"]
        : [destination];
    try {
        for (const printDestination of destinations) {
            const selectedId = settings?.selectedBillTemplateIds?.[printDestination]
                || settings?.selectedBillTemplateId;
            const selectedTemplate = templates.find((template) => template.id === selectedId) || templates[0];
            await printSingleOrder(order, printDestination, selectedTemplate);
        }
        return true;
    } catch (error) {
        window.alert(error.message);
        return false;
    }
};

export const isDesktop = () => Boolean(window.pflDesktop);