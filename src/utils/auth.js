export const AUTH_STORAGE_KEY = "pfl-auth-user";
const USERS_STORAGE_KEY = "pfl-users-v1";

export const getCurrentUser = () => {
    try {
        return JSON.parse(sessionStorage.getItem(AUTH_STORAGE_KEY));
    } catch {
        return null;
    }
};

const getConfiguredAccounts = () => [
    { name: import.meta.env.VITE_CASHIER_NAME, username: import.meta.env.VITE_CASHIER_USERNAME, password: import.meta.env.VITE_CASHIER_PASSWORD, role: "Cashier" },
    { name: import.meta.env.VITE_ADMIN_NAME, username: import.meta.env.VITE_ADMIN_USERNAME, password: import.meta.env.VITE_ADMIN_PASSWORD, role: "Admin" },
];

const readStoredUsers = () => {
    try {
        return JSON.parse(localStorage.getItem(USERS_STORAGE_KEY)) || [];
    } catch {
        return [];
    }
};

export const readUsers = () => {
    try {
        return readStoredUsers().length > 0 ? readStoredUsers().map((account) => ({ name: account.name, username: account.username, role: account.role })) : getConfiguredAccounts().map((account) => ({ name: account.name, username: account.username, role: account.role }));
    } catch {
        return [];
    }
};

export const saveUsers = (users) => localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));

export const getManageableUsers = async () => window.pflDesktop ? window.pflDesktop.getUsers() : readUsers();
export const saveManageableUsers = async (users) => window.pflDesktop ? window.pflDesktop.setUsers(users) : saveUsers(users);

export const signIn = async (username, password) => {
    const account = window.pflDesktop
        ? await window.pflDesktop.authenticate({ username, password })
        : [...getConfiguredAccounts(), ...readStoredUsers()].find((candidate) => candidate.username === username && candidate.password === password);
    if (!account) return null;
    const user = { name: account.name, username: account.username, role: account.role };
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    return user;
};

export const signOut = () => sessionStorage.removeItem(AUTH_STORAGE_KEY);