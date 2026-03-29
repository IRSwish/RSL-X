import { getDatabase, ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";

// ==================== AUTH STATE ====================
let currentRoom = null;
let currentAccessMode = null; // 'admin' or 'viewer'
let isViewerMode = false;

// ==================== STORAGE KEYS ====================
const STORAGE_KEYS = {
    ROOM_ID: 'siege_room_id',
    ACCESS_MODE: 'siege_access_mode',
    PASSWORD: 'siege_password'
};

// ==================== UTILITY FUNCTIONS ====================
function generateRoomId() {
    const adjectives = ['swift', 'brave', 'mighty', 'noble', 'fierce', 'wise', 'bold', 'grand'];
    const nouns = ['dragon', 'phoenix', 'titan', 'warrior', 'guardian', 'sentinel', 'champion', 'legend'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    return `${adj}-${noun}-${num}`;
}

function showError(message) {
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = message;
    errorEl.classList.add('active');
    setTimeout(() => errorEl.classList.remove('active'), 4000);
}

function showStatus(message) {
    const statusEl = document.getElementById('loginStatus');
    statusEl.textContent = message;
    statusEl.classList.add('active');
    setTimeout(() => statusEl.classList.remove('active'), 3000);
}

function hideLoginModal() {
    document.getElementById('loginModal').classList.remove('active');
}

function showLoginModal() {
    document.getElementById('loginModal').classList.add('active');
}

// ==================== PASSWORD HASHING ====================
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ==================== FIREBASE ROOM OPERATIONS ====================
async function createRoom(db, roomId, adminPassword, viewerPassword) {
    try {
        const roomRef = ref(db, `rooms/${roomId}`);
        const snapshot = await get(roomRef);

        if (snapshot.exists()) {
            showError('Room ID already exists. Please choose another one.');
            return false;
        }

        const adminHash = await hashPassword(adminPassword);
        const viewerHash = await hashPassword(viewerPassword);

        await set(ref(db, `rooms/${roomId}/config`), {
            adminPassword: adminHash,
            viewerPassword: viewerHash,
            createdAt: Date.now()
        });

        showStatus('Room created successfully!');
        return true;
    } catch (error) {
        console.error('Error creating room:', error);
        showError('Failed to create room. Please try again.');
        return false;
    }
}

async function verifyRoomAccess(db, roomId, password, accessMode) {
    try {
        // First check if it's a new room structure (rooms/{roomId}/config)
        const configRef = ref(db, `rooms/${roomId}/config`);
        const configSnapshot = await get(configRef);

        if (configSnapshot.exists()) {
            // New room with password protection
            const config = configSnapshot.val();
            const passwordHash = await hashPassword(password);
            const expectedHash = accessMode === 'admin' ? config.adminPassword : config.viewerPassword;

            if (passwordHash !== expectedHash) {
                showError('Incorrect password.');
                return false;
            }

            return true;
        }

        // Check if it's a legacy room (old structure: siege/{roomId})
        const legacyRef = ref(db, `siege/${roomId}`);
        const legacySnapshot = await get(legacyRef);

        if (legacySnapshot.exists()) {
            // Legacy room found - allow access without password
            showStatus('Legacy room detected. Migrating to new structure...');

            // Automatically migrate to new structure
            await migrateLegacyRoom(db, roomId);

            // Allow access as admin (no password needed for legacy rooms)
            return true;
        }

        // Room not found in either structure
        showError('Room not found.');
        return false;
    } catch (error) {
        console.error('Error verifying access:', error);
        showError('Failed to verify access. Please try again.');
        return false;
    }
}

async function migrateLegacyRoom(db, roomId) {
    try {
        // Read all data from old structure
        const legacyRef = ref(db, `siege/${roomId}`);
        const legacySnapshot = await get(legacyRef);

        if (!legacySnapshot.exists()) {
            return false;
        }

        const legacyData = legacySnapshot.val();

        // Create new room structure with default passwords (user will be prompted to change them)
        const defaultAdminPassword = await hashPassword('admin123');
        const defaultViewerPassword = await hashPassword('viewer123');

        // Write to new structure
        await set(ref(db, `rooms/${roomId}/config`), {
            adminPassword: defaultAdminPassword,
            viewerPassword: defaultViewerPassword,
            createdAt: Date.now(),
            migratedFrom: 'legacy',
            migrationNote: '⚠️ Default passwords: admin=admin123, viewer=viewer123. Please change them!'
        });

        await set(ref(db, `rooms/${roomId}/siege`), legacyData);

        console.log('Legacy room migrated successfully');

        // Show alert to user about default passwords
        setTimeout(() => {
            alert('⚠️ LEGACY ROOM MIGRATED\n\nThis room has been migrated to the new secure structure.\n\nDefault passwords:\n• Admin: admin123\n• Viewer: viewer123\n\nYou can now access it with these passwords.\nPlease change them as soon as possible for security!');
        }, 1000);

        return true;
    } catch (error) {
        console.error('Error migrating legacy room:', error);
        return false;
    }
}

// ==================== SESSION MANAGEMENT ====================
function saveSession(roomId, accessMode, password) {
    localStorage.setItem(STORAGE_KEYS.ROOM_ID, roomId);
    localStorage.setItem(STORAGE_KEYS.ACCESS_MODE, accessMode);
    localStorage.setItem(STORAGE_KEYS.PASSWORD, password);
}

function loadSession() {
    return {
        roomId: localStorage.getItem(STORAGE_KEYS.ROOM_ID),
        accessMode: localStorage.getItem(STORAGE_KEYS.ACCESS_MODE),
        password: localStorage.getItem(STORAGE_KEYS.PASSWORD)
    };
}

function clearSession() {
    localStorage.removeItem(STORAGE_KEYS.ROOM_ID);
    localStorage.removeItem(STORAGE_KEYS.ACCESS_MODE);
    localStorage.removeItem(STORAGE_KEYS.PASSWORD);
}

async function restoreSession(db) {
    const session = loadSession();

    if (!session.roomId || !session.accessMode || !session.password) {
        return false;
    }

    // SECURITY: Check if URL contains a room parameter
    const urlParams = new URLSearchParams(window.location.search);
    const urlRoom = urlParams.get('room');

    // If URL has a different room than saved session, force logout
    if (urlRoom && urlRoom !== session.roomId) {
        console.warn('Room mismatch detected. Forcing logout for security.');
        clearSession();
        showError('Session expired. Please login to access this room.');
        return false;
    }

    const isValid = await verifyRoomAccess(db, session.roomId, session.password, session.accessMode);

    if (isValid) {
        currentRoom = session.roomId;
        currentAccessMode = session.accessMode;
        isViewerMode = (session.accessMode === 'viewer');
        updateRoomInfo();
        return true;
    } else {
        clearSession();
        return false;
    }
}

function updateRoomInfo() {
    const roomLabel = document.getElementById('currentRoomLabel');
    if (roomLabel && currentRoom) {
        const modeIcon = isViewerMode ? '👁️' : '⚡';
        roomLabel.textContent = `${modeIcon} ${currentRoom} (${currentAccessMode})`;
    }
}

// ==================== PASSWORD MANAGEMENT ====================
async function changeRoomPasswords(db, roomId, newAdminPassword, newViewerPassword) {
    try {
        if (!newAdminPassword || !newViewerPassword) {
            showPasswordError('Both passwords are required.');
            return false;
        }

        if (newAdminPassword === newViewerPassword) {
            showPasswordError('Admin and viewer passwords must be different.');
            return false;
        }

        if (newAdminPassword.length < 6 || newViewerPassword.length < 6) {
            showPasswordError('Passwords must be at least 6 characters long.');
            return false;
        }

        const adminHash = await hashPassword(newAdminPassword);
        const viewerHash = await hashPassword(newViewerPassword);

        const configRef = ref(db, `rooms/${roomId}/config`);
        const snapshot = await get(configRef);

        if (!snapshot.exists()) {
            showPasswordError('Room config not found.');
            return false;
        }

        const config = snapshot.val();
        config.adminPassword = adminHash;
        config.viewerPassword = viewerHash;
        config.lastPasswordChange = Date.now();

        await set(configRef, config);

        showPasswordStatus('Passwords changed successfully!');
        return true;
    } catch (error) {
        console.error('Error changing passwords:', error);
        showPasswordError('Failed to change passwords.');
        return false;
    }
}

function showPasswordError(message) {
    const errorEl = document.getElementById('passwordError');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.classList.add('active');
        setTimeout(() => errorEl.classList.remove('active'), 4000);
    }
}

function showPasswordStatus(message) {
    const statusEl = document.getElementById('passwordStatus');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.classList.add('active');
        setTimeout(() => statusEl.classList.remove('active'), 3000);
    }
}

function showChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.classList.add('active');
        // Clear fields
        document.getElementById('newAdminPassword').value = '';
        document.getElementById('confirmAdminPassword').value = '';
        document.getElementById('newViewerPassword').value = '';
        document.getElementById('confirmViewerPassword').value = '';
    }
}

function hideChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// ESC key handler for password modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const passwordModal = document.getElementById('changePasswordModal');
        if (passwordModal && passwordModal.classList.contains('active')) {
            hideChangePasswordModal();
        }
    }
});

// ==================== EXPORT/IMPORT ====================
async function exportSiegeData(db, roomId) {
    try {
        const siegeRef = ref(db, `rooms/${roomId}/siege`);
        const snapshot = await get(siegeRef);

        if (!snapshot.exists()) {
            showError('No data to export.');
            return;
        }

        const data = snapshot.val();
        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            roomId: roomId,
            data: data
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `siege_backup_${roomId}_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showStatus('Data exported successfully!');
    } catch (error) {
        console.error('Error exporting data:', error);
        showError('Failed to export data.');
    }
}

async function importSiegeData(db, roomId, fileContent) {
    try {
        const importData = JSON.parse(fileContent);

        if (!importData.version || !importData.data) {
            showError('Invalid backup file format.');
            return false;
        }

        await set(ref(db, `rooms/${roomId}/siege`), importData.data);
        showStatus('Data imported successfully! Reloading...');

        setTimeout(() => {
            window.location.reload();
        }, 1500);

        return true;
    } catch (error) {
        console.error('Error importing data:', error);
        showError('Failed to import data. Please check the file format.');
        return false;
    }
}

// ==================== UI SETUP ====================
export function setupAuthUI(db) {
    const loginModal = document.getElementById('loginModal');
    const joinTab = document.getElementById('joinTab');
    const createTab = document.getElementById('createTab');
    const joinTabContent = document.getElementById('joinTabContent');
    const createTabContent = document.getElementById('createTabContent');
    const generateRoomIdBtn = document.getElementById('generateRoomId');
    const createRoomIdInput = document.getElementById('createRoomId');
    const joinRoomSubmit = document.getElementById('joinRoomSubmit');
    const createRoomSubmit = document.getElementById('createRoomSubmit');

    // Tab switching
    joinTab.addEventListener('click', () => {
        joinTab.classList.add('active');
        createTab.classList.remove('active');
        joinTabContent.classList.add('active');
        createTabContent.classList.remove('active');
    });

    createTab.addEventListener('click', () => {
        createTab.classList.add('active');
        joinTab.classList.remove('active');
        createTabContent.classList.add('active');
        joinTabContent.classList.remove('active');
    });

    // Access mode selector (Join tab)
    document.querySelectorAll('#joinTabContent .access-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#joinTabContent .access-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Generate Room ID button
    generateRoomIdBtn.addEventListener('click', () => {
        createRoomIdInput.value = generateRoomId();
    });

    // Join Room
    joinRoomSubmit.addEventListener('click', async () => {
        const roomId = document.getElementById('joinRoomId').value.trim();
        const password = document.getElementById('joinPassword').value;
        const accessMode = document.querySelector('#joinTabContent .access-mode-btn.active').dataset.mode;

        if (!roomId) {
            showError('Please enter a room ID.');
            return;
        }

        // If no password provided, try to access/migrate legacy room
        if (!password) {
            joinRoomSubmit.disabled = true;
            joinRoomSubmit.textContent = 'Checking legacy room...';

            // Check if it's a legacy room
            const legacyRef = ref(db, `siege/${roomId}`);
            const legacySnapshot = await get(legacyRef);

            if (legacySnapshot.exists()) {
                // Migrate legacy room
                showStatus('Legacy room detected. Migrating...');
                await migrateLegacyRoom(db, roomId);

                // After migration, user needs to use the default passwords
                showError('Room migrated! Use password "admin123" or "viewer123" to connect.');
                joinRoomSubmit.disabled = false;
                joinRoomSubmit.textContent = 'Join Room';
                return;
            } else {
                showError('Room not found or password required.');
                joinRoomSubmit.disabled = false;
                joinRoomSubmit.textContent = 'Join Room';
                return;
            }
        }

        joinRoomSubmit.disabled = true;
        joinRoomSubmit.textContent = 'Joining...';

        const isValid = await verifyRoomAccess(db, roomId, password, accessMode);

        if (isValid) {
            currentRoom = roomId;
            currentAccessMode = accessMode;
            isViewerMode = (accessMode === 'viewer');
            saveSession(roomId, accessMode, password);
            updateRoomInfo();
            hideLoginModal();
            showStatus(`Joined room as ${accessMode}!`);

            // Trigger app initialization
            window.dispatchEvent(new CustomEvent('roomReady', {
                detail: { roomId, accessMode, isViewerMode }
            }));
        }

        joinRoomSubmit.disabled = false;
        joinRoomSubmit.textContent = 'Join Room';
    });

    // Create Room
    createRoomSubmit.addEventListener('click', async () => {
        let roomId = createRoomIdInput.value.trim();
        const adminPassword = document.getElementById('createAdminPassword').value;
        const viewerPassword = document.getElementById('createViewerPassword').value;

        if (!roomId) {
            roomId = generateRoomId();
            createRoomIdInput.value = roomId;
        }

        if (!adminPassword || !viewerPassword) {
            showError('Please set both passwords.');
            return;
        }

        if (adminPassword === viewerPassword) {
            showError('Admin and viewer passwords must be different.');
            return;
        }

        createRoomSubmit.disabled = true;
        createRoomSubmit.textContent = 'Creating...';

        const success = await createRoom(db, roomId, adminPassword, viewerPassword);

        if (success) {
            // Auto-login as admin
            currentRoom = roomId;
            currentAccessMode = 'admin';
            isViewerMode = false;
            saveSession(roomId, 'admin', adminPassword);
            updateRoomInfo();
            hideLoginModal();

            // Trigger app initialization
            window.dispatchEvent(new CustomEvent('roomReady', {
                detail: { roomId, accessMode: 'admin', isViewerMode: false }
            }));
        }

        createRoomSubmit.disabled = false;
        createRoomSubmit.textContent = 'Create Room';
    });

    // Change Password Modal handlers
    const closePasswordModalBtn = document.getElementById('closePasswordModal');
    const savePasswordsBtn = document.getElementById('savePasswordsBtn');

    if (closePasswordModalBtn) {
        closePasswordModalBtn.addEventListener('click', hideChangePasswordModal);
    }

    if (savePasswordsBtn) {
        savePasswordsBtn.addEventListener('click', async () => {
            const newAdminPassword = document.getElementById('newAdminPassword').value;
            const confirmAdminPassword = document.getElementById('confirmAdminPassword').value;
            const newViewerPassword = document.getElementById('newViewerPassword').value;
            const confirmViewerPassword = document.getElementById('confirmViewerPassword').value;

            // Validate confirmations
            if (newAdminPassword !== confirmAdminPassword) {
                showPasswordError('Admin passwords do not match.');
                return;
            }

            if (newViewerPassword !== confirmViewerPassword) {
                showPasswordError('Viewer passwords do not match.');
                return;
            }

            savePasswordsBtn.disabled = true;
            savePasswordsBtn.textContent = 'Saving...';

            const success = await changeRoomPasswords(db, currentRoom, newAdminPassword, newViewerPassword);

            if (success) {
                // Update session with new admin password if user is admin
                if (currentAccessMode === 'admin') {
                    saveSession(currentRoom, currentAccessMode, newAdminPassword);
                }

                setTimeout(() => {
                    hideChangePasswordModal();
                }, 2000);
            }

            savePasswordsBtn.disabled = false;
            savePasswordsBtn.textContent = 'Save Passwords';
        });
    }

    // Pre-fill room ID from URL query param (?room=...)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        const joinRoomIdInput = document.getElementById('joinRoomId');
        if (joinRoomIdInput) joinRoomIdInput.value = roomParam;
    }

    // Default access mode: viewer
    document.querySelectorAll('#joinTabContent .access-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === 'viewer');
    });

    // Try to restore session on load
    restoreSession(db).then(restored => {
        if (restored) {
            // Trigger app initialization
            window.dispatchEvent(new CustomEvent('roomReady', {
                detail: {
                    roomId: currentRoom,
                    accessMode: currentAccessMode,
                    isViewerMode
                }
            }));
        } else {
            showLoginModal();
        }
    });
}

// ==================== EXPORTS ====================
export function getCurrentRoom() {
    return currentRoom;
}

export function getCurrentAccessMode() {
    return currentAccessMode;
}

export function isViewer() {
    return isViewerMode;
}

export function logout() {
    clearSession();
    window.location.reload();
}

export { exportSiegeData, importSiegeData, showChangePasswordModal };
