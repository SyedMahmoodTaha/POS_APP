export const BILL_TEMPLATES_STORAGE_KEY = "pfl-bill-templates-v1";

export const BILL_FIELD_DEFINITIONS = [
    { key: "logo", label: "Logo" },
    { key: "businessName", label: "Business name" },
    { key: "items", label: "Items table" },
    { key: "itemPrice", label: "Item prices" },
    { key: "dateTime", label: "Date and time" },
    { key: "billNumber", label: "Bill number" },
    { key: "billType", label: "Bill type" },
    { key: "cashierName", label: "Captain" },
    { key: "customerName", label: "Customer name" },
    { key: "phone", label: "Phone number" },
    { key: "address", label: "Address" },
    { key: "tableNumber", label: "Table number" },
    { key: "deliveryCharges", label: "Delivery charge" },
    { key: "parcelCharges", label: "Parcel charge" },
    { key: "subtotal", label: "Subtotal" },
    { key: "total", label: "Total" },
    { key: "discount", label: "Discount" },
    { key: "note", label: "Order note" },
    { key: "footer", label: "Footer" },
];

const allFields = BILL_FIELD_DEFINITIONS.reduce((fields, field) => ({ ...fields, [field.key]: true }), {});
const defaultFieldOrder = BILL_FIELD_DEFINITIONS.map((field) => field.key);

export const createBillTemplate = (overrides = {}) => ({
    id: overrides.id || `template-${Date.now()}`,
    name: overrides.name || "New bill layout",
    layout: overrides.layout || "classic",
    paperWidth: Number(overrides.paperWidth) || 80,
    alignment: overrides.alignment || "center",
    businessName: overrides.businessName ?? "Lassi Shop",
    footerText: overrides.footerText ?? "Thank you for visiting us",
    headerText: overrides.headerText ?? "",
    fields: { ...allFields, ...(overrides.fields || {}) },
    fieldOrder: Array.isArray(overrides.fieldOrder) ? overrides.fieldOrder : defaultFieldOrder,
    dividers: Array.isArray(overrides.dividers) ? overrides.dividers : [],
});

export const defaultBillTemplates = [
    createBillTemplate({ id: "classic", name: "Classic 80mm", layout: "classic" }),
    createBillTemplate({
        id: "minimal",
        name: "Minimal receipt",
        layout: "minimal",
        fields: { logo: false, address: false, note: false, footer: false },
    }),
    createBillTemplate({
        id: "customer",
        name: "Customer details",
        layout: "customer",
        headerText: "Freshly prepared for you",
        fields: { logo: true, customerName: true, phone: true, address: true, note: true },
    }),
];

export const normalizeBillTemplate = (template, fallback = defaultBillTemplates[0]) => {
    const normalized = createBillTemplate({ ...fallback, ...(template || {}) });
    const savedOrder = Array.isArray(template?.fieldOrder) ? template.fieldOrder : [];
    const fieldOrder = savedOrder.includes("items")
        ? savedOrder
        : [...savedOrder.slice(0, 2), "items", ...savedOrder.slice(2)];
    return {
        ...normalized,
        fields: { ...fallback.fields, ...(template?.fields || {}) },
        fieldOrder: [...new Set([...fieldOrder, ...defaultFieldOrder])],
        dividers: Array.isArray(template?.dividers) ? template.dividers : [],
    };
};

export const normalizeBillTemplates = (templates) => {
    if (!Array.isArray(templates) || templates.length === 0) return defaultBillTemplates;
    return templates.map((template) => normalizeBillTemplate(template));
};

export const readLocalBillTemplates = () => {
    try {
        return normalizeBillTemplates(JSON.parse(localStorage.getItem(BILL_TEMPLATES_STORAGE_KEY)));
    } catch {
        return defaultBillTemplates;
    }
};

export const saveLocalBillTemplates = (templates) => {
    const normalized = normalizeBillTemplates(templates);
    localStorage.setItem(BILL_TEMPLATES_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
};
