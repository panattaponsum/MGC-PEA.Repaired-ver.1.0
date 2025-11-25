// Firebase config
const firebaseConfig = {
apiKey: "AIzaSyCe-qS_uKPYASKJHHL0JuV4eCCzajbpzRY",
authDomain: "microgrid-th.firebaseapp.com",
projectId: "microgrid-th",
storageBucket: "microgrid-th.firebasestorage.app",
messagingSenderId: "88058740399",
appId: "1:88058740399:web:bbb38da765672dc4969e5a",
measurementId: "G-L45B835SV4"
};

// Initialize Firebase (ใช้ชื่อฟังก์ชัน Global ที่ถูกโหลดมา)
firebase.initializeApp(firebaseConfig); 
const db = firebase.firestore(); 
// 💥 NEW: Initialize Auth (ต้องมีสำหรับ `main.js` นี้) 💥
const auth = firebase.auth(); 
const devicesCol = db.collection("devices"); 
// 💡 Not used globally in this structure, but kept for context 

const sites = {
"ko-phaluay": {
name: "ไมโครกริดเกาะพะลวย อ.เกาะสมุย จ.สุราษฎานี",
devices: [
"HMI Server 1", "HMI Server 2", "Operation Station", "Printer", "Time Server", "MGC",
"Switch 1", "Switch 2", "Switch 3", "Switch 4", "Switch 5", "Switch 6", "Switch 7", "Switch 8",
"COV 1", "COV 2", "BCP", "PCS",
"Inverter 1", "Inverter 2", "Inverter 3", "Inverter 4", "Inverter 5",
"Inverter 6", "Inverter 7", "Inverter 8", "Inverter 9", "Inverter 10",
"DG 1", "DG 2", "DG Master",
"Gateway 1", "Gateway 2",
"Firewall 1", "Firewall 2", "Firewall 3"
]
},
"mae-sariang": {
name: "ไมโครกริดแม่สะเรียง อ.แม่สะเรียง จ.แม่ฮ่องสอน",
devices: [
"FireWall 1", "PCS-9893(2nd)", "HMI Display 1", "HMI Display 2", "HMI Main 1", "Cyber Security Manager", "Scada 1", "Scada 2", "Switch 1", "Switch 2", "Switch 3", "Switch 4", "Switch 5", "Switch 6", "Switch 7", "ETH Switch 1", "ETH Switch 2", "PCS-9892", "PCS-9893(1st)", "PCS-9799(1st)", "PCS-9799(2nd)", "MGC 1", "MGC 2", "ATS", "PCS-9794(1st)", "Diesel Local", "PCS-9794(2nd)", "PCS-9726", "PCS-9567C", "PCS 1", "PCS 2", "PCS 3", "PCS 4", "PCS 5", "PCS 6", "ETH Switch 3", "BMS 1", "BMS 2", "BMS 3", "BMS 4", "BMS 5", "BMS 6", "FRTU 1-15"
]
},
"betong": {
name: "ไมโครกริดเบตง อ.เบตง จ.ยะลา",
devices: [
"Operator HMI 24", "Operator HMI 27", "ETH Switch 1", "ETH Switch 2", "ETH Switch 3", "ETH Switch 4", "ETH Switch 6", "ETH Switch 7"
]
}
};
 let currentSiteKey = "ko-phaluay";
let currentDevice = null, editIndex = -1, chartInstance = null;
let currentPage = 1;
const pageSize = 7; // 💡 Note: This is overridden by 10 in updateDeviceSummary, kept for consistency
let currentUser = null;
/**
* Helper function to escape HTML characters
*/
function escapeHtml(text) {
return String(text || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] || m)).replace(/\n/g, '<br>');
}

/**
* Returns the Firestore Collection reference for devices in the current site.
*/
function getSiteCollection(siteKey) {
return db.collection(`sites`).doc(siteKey).collection(`devices`);
}

/**
* Fetches and processes records for a specific device.
*/
async function getDeviceRecords(siteKey, device) {
const docRef = getSiteCollection(siteKey).doc(device); 
const snap = await docRef.get();
const recs = snap.exists ? (snap.data().records || []) : [];
// Ensure all records have 'counted' property
for (const r of recs) {
if (typeof r.counted === 'undefined') r.counted = (r.status === 'down');
}
return recs;
}

/**
* Saves the updated records array back to Firestore, calculating downCount and currentStatus.
*/
async function saveDeviceRecords(siteKey, device, records) {
// Ensure all records have 'counted' property before saving
for (const r of records) {
if (typeof r.counted === 'undefined') r.counted = (r.status === 'down');
}

// 1. เรียงลำดับบันทึกเพื่อหาอันล่าสุด
records.sort((a, b) => a.ts - b.ts); // เรียงจากเก่าไปใหม่
const latestRecord = records[records.length - 1];

// 2. นับจำนวนครั้งที่ชำรุด (เฉพาะรายการที่มี counted: true)
const downCount = records.filter(r => r.counted).length;

// 3. กำหนดสถานะปัจจุบันจากรายการล่าสุด
const currentStatus = latestRecord ? latestRecord.status : 'ok'; // 'ok' หากไม่มีรายการ

const docRef = getSiteCollection(siteKey).doc(device);

// บันทึก records, downCount และ currentStatus
await docRef.set({ 
records, 
downCount,
currentStatus: currentStatus 
}, { merge: true }); // 💥 MODIFIED: เพิ่ม merge: true เพื่อไม่ให้ทับ assetInfo
}

/**
* Fetches all device documents for a given site.
*/
async function getAllDevicesDocs(siteKey) {
return await getSiteCollection(siteKey).get();
}

/**
* Calculates the difference between two dates in full days.
* @param {string} dateString1 - Start date string (YYYY-MM-DD).
* @param {string} [dateString2] - End date string (YYYY-MM-DD). If null/undefined, uses today.
* @returns {number} The number of full days.
*/
function calculateDaysDifference(dateString1, dateString2) {
if (!dateString1) return 0;
if (isNaN(new Date(dateString1).getTime())) return 0;

const date1 = new Date(dateString1);
// Use dateString2 or today's date if dateString2 is missing/invalid
const date2 = dateString2 && !isNaN(new Date(dateString2).getTime()) ? new Date(dateString2) : new Date(); 

const _MS_PER_DAY = 1000 * 60 * 60 * 24;

// Use UTC for comparison to avoid time zone issues affecting day calculation
const utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate());
const utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate());

// Use Math.ceil() to ensure a fraction of a day is counted as 1 day, 
// and that same-day events (diff of 0) result in 1 day.
const diffDays = Math.ceil(Math.abs((utc2 - utc1) / _MS_PER_DAY));

return diffDays;
}

/**
* Formats the number of days into an approximate duration (Year, Month, Day).
*/
function formatDuration(days) {
if (days <= 0) return '0 วัน';
const YEARS_IN_DAYS = 365.25; 
const MONTHS_IN_DAYS = 30.44;
let remainingDays = days;
let parts = [];

const years = Math.floor(remainingDays / YEARS_IN_DAYS);
if (years > 0) {
parts.push(`${years} ปี`);
remainingDays -= years * YEARS_IN_DAYS;
}

const months = Math.floor(remainingDays / MONTHS_IN_DAYS);
if (months > 0) {
parts.push(`${months} เดือน`);
remainingDays -= months * MONTHS_IN_DAYS;
}

// Always include days unless years/months cover most of the period
const finalDays = Math.ceil(remainingDays);
if (finalDays > 0 || (days > 0 && parts.length === 0)) { 
parts.push(`${finalDays} วัน`);
}

return parts.join(' ');
}

/**
* คำนวณสถานะการรับประกัน
* @param {string} warrantyEnd (YYYY-MM-DD)
* @returns {string} สถานะ (ok, warn, bad, -)
*/
function getWarrantyStatus(warrantyEnd) {
if (!warrantyEnd || !isValidDate(warrantyEnd)) {
return '-'; // ยังไม่ลงทะเบียน
}

const today = new Date();
const endDate = new Date(warrantyEnd);
today.setHours(0, 0, 0, 0);
endDate.setHours(0, 0, 0, 0);

const diffTime = endDate.getTime() - today.getTime();
const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

if (diffDays < 0) {
return 'bad'; // หมดประกันแล้ว
} else if (diffDays <= 30) {
return 'warn'; // ใกล้หมดประกัน (30 วัน)
} else {
return 'ok'; // รับประกัน
}
}

/**
* สร้าง HTML tag สำหรับสถานะการรับประกัน
* @param {string} status ('ok', 'warn', 'bad', or any other string)
* @returns {string} HTML string
*/
function getWarrantyStatusHTML(status) {
switch (status) {
case 'ok':
return '<span class="tag tag-warranty-ok">🛡️ รับประกัน</span>';
case 'warn':
return '<span class="tag tag-warranty-warn">⚠️ ใกล้หมดประกัน</span>';
case 'bad':
return '<span class="tag tag-warranty-bad">🚫 หมดประกัน</span>';
default:
return '<span>-</span>';
}
}


/**
* เปิด/ปิดการใช้งานปุ่มที่ใช้เขียนข้อมูล
* @param {boolean} isLoggedIn ผู้ใช้ล็อคอินอยู่หรือไม่
*/
function toggleWriteAccess(isLoggedIn) {
// ปิด/เปิด ปุ่มหลัก
const buttonsToToggle = [
'saveDataButton', 
'clearDeviceButton', 
'clearAllButton',
'saveAssetButton' // ปุ่มบันทึกข้อมูลทรัพย์สิน
];

buttonsToToggle.forEach(id => {
const btn = document.getElementById(id);
if (btn) {
btn.disabled = !isLoggedIn;
btn.title = isLoggedIn ? '' : 'กรุณาลงชื่อเข้าใช้ก่อน';
}
});

// ซ่อน/แสดง ปุ่มนำเข้า (ที่เป็น Label)
const importLabel = document.getElementById('importButtonLabel');
if (importLabel) {
importLabel.style.display = isLoggedIn ? 'inline-block' : 'none';
importLabel.title = isLoggedIn ? '' : 'กรุณาลงชื่อเข้าใช้ก่อน';
}

// อัปเดตปุ่มในประวัติ (ถ้า Modal เปิดอยู่)
// การเรียก loadHistory() ซ้ำจะจัดการเรื่องนี้ให้เอง
if (document.getElementById('formModal').style.display === 'flex') { // 💥 FIX: รองรับ flex
loadHistory(); 
}

// อัปเดตช่องชื่อผู้ใช้
const userNameInput = document.getElementById('userName');
if (isLoggedIn && currentUser) {
// 💥 FIX 1.1: ใช้ email แทน displayName
userNameInput.value = currentUser.email; 
userNameInput.readOnly = true;
} else {
userNameInput.value = 'ผู้เยี่ยมชม (อ่านอย่างเดียว)';
userNameInput.readOnly = true;
}
}

// 💥 NEW: Auth Functions 💥
function login() {
const provider = new firebase.auth.GoogleAuthProvider();
auth.signInWithPopup(provider)
.then((result) => {
// สำเร็จ (จัดการโดย onAuthStateChanged)
}).catch((error) => {
console.error("Login Error:", error);
Swal.fire('Login ผิดพลาด', error.message, 'error');
});
}

function logout() {
auth.signOut();
}


// =========================================================================
// UI and Form Functions (Global Scope for HTML interaction)
// =========================================================================

window.openForm = async function(deviceName) {
    currentDevice = deviceName; 
    editIndex = -1;
    document.getElementById('formTitle').textContent = `บันทึกข้อมูล: ${deviceName}`;
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('formModal').style.display = 'flex';
    document.getElementById('editHint').classList.add('hidden');

    // รีเซ็ตหน้าจอข้อมูลทรัพย์สิน
    document.getElementById('warrantyStatusDisplay').innerHTML = 'กำลังโหลด...';
    document.getElementById('assetInfoDisplay').innerHTML = '';

    // 💥 เรียก clearForm ซึ่งจะตั้งค่าเป็น 'down' และล็อคปุ่มให้เองอัตโนมัติ
    clearForm(); 

    await loadHistory(); 
}

window.closeForm = function() {
document.getElementById('overlay').style.display = 'none';
document.getElementById('formModal').style.display = 'none'; // 💥 FIX: ใช้ none
// 💡 ปิดหน้า Asset ด้วย (ถ้าเผลอเปิดค้าง)
closeAssetModal(false); 
}

function clearForm() {
    // Check Auth for userName
    if (!currentUser) {
        document.getElementById('userName').value = 'ผู้เยี่ยมชม (อ่านอย่างเดียว)';
    } else {
        document.getElementById('userName').value = currentUser.email;
    }

    const statusSelect = document.getElementById('status');
    
    // 💥 FIX: รีเซ็ตค่าเป็น 'down' (ชำรุด) เสมอ และสั่ง ล็อค (disabled) ทันที
    statusSelect.value = 'down'; 
    statusSelect.disabled = true; 

    document.getElementById('brokenDate').value = '';
    document.getElementById('fixedDate').value = '';
    document.getElementById('description').value = '';
    
    // รีเซ็ต index การแก้ไข
    editIndex = -1;
    document.getElementById('editHint').classList.add('hidden');
}

function isValidDate(str) {
if (!str) return false;
const d = new Date(str);
return d instanceof Date && !isNaN(d);
}

window.saveData = async function() {
// 💥 MODIFIED: Check Auth 💥
if (!currentUser) {
Swal.fire('ไม่ได้รับอนุญาต', 'กรุณาลงชื่อเข้าใช้ก่อนบันทึกข้อมูล', 'warning');
return false;
}

if (!currentDevice) {
Swal.fire("ผิดพลาด", "กรุณาเลือกอุปกรณ์", "error"); // 💥 MODIFIED
return false;
}

const statusVal = document.getElementById('status').value;
const brokenDate = document.getElementById('brokenDate').value;
const fixedDate = document.getElementById('fixedDate').value;

if (editIndex < 0 && statusVal === 'ok') {
        Swal.fire({
            title: "ไม่อนุญาต", 
            text: "การเพิ่มรายการใหม่ต้องเป็นสถานะ 'ชำรุด' เท่านั้น \n(หากต้องการบันทึกว่าซ่อมเสร็จแล้ว กรุณากด 'แก้ไข' ที่รายการชำรุดเดิม)", 
            icon: "warning"
        });
        return false;
    }
// VALIDATION: ห้ามวันที่ชำรุด/ซ่อมแซมอยู่หลังวันที่ปัจจุบัน
const now = new Date();
now.setHours(0, 0, 0, 0); 

if (brokenDate && isValidDate(brokenDate)) {
const brokenDateTime = new Date(brokenDate);
brokenDateTime.setHours(0, 0, 0, 0); 
if (brokenDateTime > now) {
Swal.fire("วันที่ผิดพลาด", "วันที่ชำรุดไม่สามารถอยู่หลังวันที่ปัจจุบันได้", "warning"); // 💥 MODIFIED
return false;
}
}

if (fixedDate && isValidDate(fixedDate)) {
const fixedDateTime = new Date(fixedDate);
fixedDateTime.setHours(0, 0, 0, 0); 
if (fixedDateTime > now) {
Swal.fire("วันที่ผิดพลาด", "วันที่ซ่อมแซมไม่สามารถอยู่หลังวันที่ปัจจุบันได้", "warning"); // 💥 MODIFIED
return false;
}
}

if (statusVal === 'down') {
if (!isValidDate(brokenDate)) {
Swal.fire("ข้อมูลไม่ครบ", "กรุณาเลือกวันที่ชำรุด เมื่อสถานะเป็น 'ชำรุด'", "warning"); // 💥 MODIFIED
return false;
}
if (fixedDate) {
Swal.fire("ข้อมูลขัดแย้ง", "ห้ามใส่วันที่ซ่อมแซม เมื่อสถานะเป็น 'ชำรุด'", "warning"); // 💥 MODIFIED
return false;
}
}

if (statusVal === 'ok') {
if (!isValidDate(brokenDate)) {
Swal.fire("ข้อมูลไม่ครบ", "กรุณาเลือกวันที่ชำรุด", "warning"); // 💥 MODIFIED
return false;
}
if (!isValidDate(fixedDate)) {
Swal.fire("ข้อมูลไม่ครบ", "กรุณาเลือกวันที่ซ่อมแซม", "warning"); // 💥 MODIFIED
return false;
}
if (new Date(brokenDate) > new Date(fixedDate)) {
Swal.fire("วันที่ผิดพลาด", "วันที่ซ่อมแซมต้องหลังวันที่ชำรุด", "warning"); // 💥 MODIFIED
return false;
}
}

if (fixedDate && statusVal !== 'ok') {
Swal.fire("ข้อมูลขัดแย้ง", "ห้ามใส่วันที่ซ่อมแซม ถ้าไม่ได้เลือกสถานะ 'ใช้งานได้'", "warning"); // 💥 MODIFIED
return false;
}

if (brokenDate && !(statusVal === 'down' || statusVal === 'ok')) {
Swal.fire("ข้อมูลขัดแย้ง", "ห้ามใส่วันที่ชำรุด ถ้าไม่ได้เลือกสถานะ 'ชำรุด' หรือ 'ใช้งานได้'", "warning"); // 💥 MODIFIED
return false;
}

let records = await getDeviceRecords(currentSiteKey, currentDevice);

// 💥 MODIFIED (1): ลบเงื่อนไขห้ามบันทึกซ้ำ ถ้าอุปกรณ์ยังชำรุด
if (editIndex < 0) { 
    const latestRecord = records.length > 0 ? records[records.length - 1] : null;
    const currentStatus = latestRecord ? latestRecord.status : 'ok'; // สถานะปัจจุบัน
    
    // 🚨 (Optional but Good Practice) ถ้าอุปกรณ์ใช้งานได้อยู่แล้ว ห้ามบันทึกรายการ 'ok' ที่มีวันที่ซ่อม
    if (currentStatus === 'ok' && statusVal === 'ok' && (brokenDate || fixedDate)) {
         Swal.fire({
            title: 'ข้อมูลขัดแย้ง',
            text: 'อุปกรณ์อยู่ในสถานะ "ใช้งานได้" อยู่แล้ว การบันทึก "ใช้งานได้" กรุณาบันทึกสถานะ "ชำรุด" เป็นรายการใหม่ก่อน แล้วจึงแก้ไขเป็นสถานะ "ใช้งานได้" ',
            icon: 'warning'
        });
        return false;
    }
}

const baseRec = {
// 💥 MODIFIED: ดึงชื่อจากช่อง Input ที่ถูกล็อคไว้ 💥
user: document.getElementById('userName').value || "ไม่ระบุ (ล็อคอิน)",
status: statusVal,
brokenDate,
fixedDate,
description: document.getElementById('description').value,
ts: Date.now(),
counted: (statusVal === 'down') 
};

if (editIndex >= 0) {
// การแก้ไข: นำข้อมูลเดิมมาทับข้อมูลใหม่
const originalRecord = records[editIndex];

records[editIndex] = {
...originalRecord,
...baseRec,
ts: originalRecord.ts
};

// ตรรกะ counted เมื่อแก้ไข
if (statusVal === 'ok') {
// ถ้าสถานะใหม่เป็น 'ok' (ซ่อมแซม) ให้คงค่า counted เป็น true ถ้ามันเคยถูกนับแล้ว
records[editIndex].counted = originalRecord.counted || false; 
} else {
// ถ้าสถานะใหม่เป็น 'down' ให้ counted เป็น true เสมอ
records[editIndex].counted = true;
}

editIndex = -1;
document.getElementById('editHint').classList.add('hidden');
} else {
// การเพิ่มรายการใหม่:
records.push(baseRec);
}
await saveDeviceRecords(currentSiteKey, currentDevice, records);
clearForm();
await loadHistory();
window.updateDeviceSummary(); 
window.updateDeviceStatusOverlays(currentSiteKey); 

// 💥 NEW: ส่งไลน์ถ้าเป็นการแจ้งชำรุดใหม่
    if (statusVal === 'down' && editIndex < 0) {
        sendLineNotify(
            currentDevice, 
            document.getElementById('description').value, 
            document.getElementById('userName').value
        );
    }

    // 💥 MODIFIED: ใช้ SweetAlert2 💥
    Swal.fire("บันทึกเรียบร้อย", "", "success");
    return true;
};

window.clearCurrentDevice = async function() {
// 💥 MODIFIED: Check Auth (ปุ่มควรจะ disable อยู่แล้ว แต่เช็คกันเหนียว) 💥
if (!currentUser) {
Swal.fire('ไม่ได้รับอนุญาต', 'กรุณาลงชื่อเข้าใช้ก่อน', 'warning');
return;
}

if (!currentDevice) return;

// 💡 ใช้ SweetAlert2
const result = await Swal.fire({
title: `ลบข้อมูล ${currentDevice}?`,
text: "คุณต้องการลบข้อมูลทั้งหมดของอุปกรณ์นี้ใช่หรือไม่?",
icon: 'warning',
showCancelButton: true,
confirmButtonColor: '#ef4444',
cancelButtonColor: '#6b7280',
confirmButtonText: 'ใช่, ลบเลย!',
cancelButtonText: 'ยกเลิก'
});

if (result.isConfirmed) {
await getSiteCollection(currentSiteKey).doc(currentDevice).set({ 
records: [], 
downCount: 0,
currentStatus: 'ok' 
// 💡 หมายเหตุ: assetInfo จะยังอยู่ ซึ่งถูกต้องแล้ว
}, { merge: true }); // 💥 MODIFIED: เพิ่ม merge: true
await loadHistory();
window.updateDeviceSummary(); 
window.updateDeviceStatusOverlays(currentSiteKey); 
Swal.fire("ลบเรียบร้อย", "", "success");
}
}

// 💥 NEW: Function to update Asset Info displays in main modal 💥
function updateAssetDisplays(assetInfo) {
const statusEl = document.getElementById('warrantyStatusDisplay');
const infoEl = document.getElementById('assetInfoDisplay');

if (assetInfo && assetInfo.warrantyEnd) {
const status = getWarrantyStatus(assetInfo.warrantyEnd);
statusEl.innerHTML = getWarrantyStatusHTML(status);

let infoParts = [];
if (assetInfo.model) infoParts.push(`รุ่น: ${escapeHtml(assetInfo.model)}`);
if (assetInfo.serial) infoParts.push(`S/N: ${escapeHtml(assetInfo.serial)}`);
infoEl.innerHTML = infoParts.join(' | ') || 'ลงทะเบียนแล้ว (ไม่มี Model/SN)';

} else {
statusEl.innerHTML = '<span class="tag tag-warranty-bad">🚫 ยังไม่ลงทะเบียน</span>';
infoEl.innerHTML = 'กรุณาคลิก "ดู/แก้ไขข้อมูลทรัพย์สิน"';
}
}

async function loadHistory() {
const container = document.getElementById('historySection');
container.innerHTML = '';
if (!currentDevice) return;

// 1. 💥 ดึงข้อมูลเอกสารเต็ม (ไม่ใช่แค่ records)
const docRef = getSiteCollection(currentSiteKey).doc(currentDevice);
let docData = null, records = [], assetInfo = null;

try {   const snap = await docRef.get({ source: 'server' }); 

if (snap.exists) {
docData = snap.data();
records = docData.records || [];
assetInfo = docData.assetInfo || null;
}
} catch (e) {
console.error("Error fetching device document:", e);
container.innerHTML = '<p>Error loading data</p>';
return;
}

// 2. อัปเดตหน้าจอข้อมูลทรัพย์สิน (ที่อยู่เหนือประวัติ)
updateAssetDisplays(assetInfo);

// 3. สร้างประวัติ (History)
records.sort((a, b) => b.ts - a.ts); // เรียงจากใหม่ไปเก่า

if (records.length === 0) {
container.innerHTML = '<p class="text-center py-4 text-gray-400">ไม่พบประวัติการบันทึกสำหรับอุปกรณ์นี้</p>';
return;
}

// 4.  ตรวจสอบสถานะล็อคอินสำหรับปุ่ม
const buttonsDisabled = currentUser ? '' : 'disabled title="กรุณาลงชื่อเข้าใช้"';

let isCurrentBrokenFound = false; 
// ไม่ต้องมีตัวนับ recordCount เพราะใช้ totalRecords - index แล้ว
const totalRecords = records.length; // จำนวนรายการทั้งหมด

records.forEach((r, index) => {

// คำนวณลำดับที่ถูกต้อง (เก่าสุดคือ 1, ใหม่สุดคือ totalRecords) 
        const recordSequence = totalRecords - index; 
let duration = '-';
if (r.brokenDate) {

if (r.fixedDate) {
// 🟢 รายการที่ "ซ่อมแล้ว"
const days = calculateDaysDifference(r.brokenDate, r.fixedDate);
duration = formatDuration(days);

} else if (!r.fixedDate && !isCurrentBrokenFound) { 
// 🟢 รายการที่ "ยังชำรุด" (และเป็นตัวแรกที่เจอ)
const days = calculateDaysDifference(r.brokenDate, null);
duration = formatDuration(days) + ' <span class="text-sm text-red-400 font-semibold">(ชำรุด)</span>';
isCurrentBrokenFound = true; // 👈 ตั้งค่าว่าเจอแล้ว

} else {
// 🟢 รายการที่ "ชำรุด" (แต่อันเก่ากว่า)
const days = calculateDaysDifference(r.brokenDate, null);
duration = formatDuration(days);
}
}

const statusClass = r.status === 'ok' ? 'tag-ok' : 'tag-bad';
const statusText = r.status === 'ok' ? '✅ ใช้งานได้' : '❎ ชำรุด';

const div = document.createElement('div');
div.className = 'p-4 mb-3 border border-gray-700 bg-gray-800 rounded-lg shadow-md'; 

div.innerHTML = `
           <div class="flex justify-between items-start border-b border-gray-700 pb-2 mb-2">
               <div class="text-lg font-bold text-white">
                   <span class="tag ${statusClass}">${statusText}</span>
					<span class="ml-2 text-base text-gray-300"> | ครั้งที่ ${recordSequence}</span>
               </div>
               <div class="text-sm text-gray-400">
                   บันทึกโดย: <span class="font-semibold text-white">${escapeHtml(r.user || 'ไม่ระบุ')}</span>
               </div>
           </div>
           <div class="grid grid-cols-2 gap-y-2 text-sm text-gray-300">
               <div class="font-medium text-white">วันที่ชำรุด:</div>
               <div>${r.brokenDate || '-'}</div>
               <div class="font-medium text-white">วันที่ซ่อมแซม:</div>
               <div>${r.fixedDate || '-'}</div>
               <div class="font-bold text-red-300">ระยะเวลาชำรุด:</div>
               <div class="font-bold text-red-300">${duration}</div>
           </div>
           <div class="mt-3 pt-3 border-t border-gray-700">
               <p class="font-medium text-white mb-1">รายละเอียด:</p>
               <div class="text-sm text-gray-300">${escapeHtml(r.description || '-')}</div>
           </div>

           <div class="mt-4 flex justify-end space-x-2">
               <button class="btn btn-ghost text-yellow-500 hover:bg-gray-700" onclick="editRecord('${r.ts}')" ${buttonsDisabled}>✏️ แก้ไข</button>
               <button class="btn btn-danger text-white-500 hover:bg-gray-700" onclick="deleteRecord('${r.ts}')" ${buttonsDisabled}>🗑️ ลบ</button>
           </div>
       `;
container.appendChild(div);
});
}
window.deleteRecord = async function(ts) {
// 💥 MODIFIED: Check Auth (ปุ่มควรจะ disable อยู่แล้ว) 💥
if (!currentUser) return;

if (!currentDevice) return;

// 💡 ใช้ SweetAlert2
const result = await Swal.fire({
title: 'ลบรายการนี้?',
text: "คุณต้องการลบรายการประวัตินี้จริงหรือไม่?",
icon: 'warning',
showCancelButton: true,
confirmButtonColor: '#ef4444',
cancelButtonColor: '#6b7280',
confirmButtonText: 'ใช่, ลบ!',
cancelButtonText: 'ยกเลิก'
});

if (!result.isConfirmed) return;

let records = await getDeviceRecords(currentSiteKey, currentDevice);
const idx = records.findIndex(r => String(r.ts) === String(ts));
if (idx < 0) return;

records.splice(idx, 1);
await saveDeviceRecords(currentSiteKey, currentDevice, records);
loadHistory();
window.updateDeviceSummary(); 
window.updateDeviceStatusOverlays(currentSiteKey); 
}

window.editRecord = async function(ts) {
    if (!currentUser) return;
    if (!currentDevice) return;
    let records = await getDeviceRecords(currentSiteKey, currentDevice);

    const idx = records.findIndex(r => String(r.ts) === String(ts));
    if (idx < 0) return;

    const r = records[idx];
    
    const statusSelect = document.getElementById('status');
    statusSelect.value = r.status || 'down';
    
    // 💥 UNLOCK: ปลดล็อคเฉพาะตอนกดแก้ไขเท่านั้น
    statusSelect.disabled = false; 

    document.getElementById('brokenDate').value = r.brokenDate || '';
    document.getElementById('fixedDate').value = r.fixedDate || '';
    document.getElementById('description').value = r.description || '';
    
    editIndex = idx;
    document.getElementById('editHint').classList.remove('hidden');
};

window.openAssetModal = async function() {
if (!currentDevice) return;

document.getElementById('assetFormTitle').textContent = `📋 ข้อมูลทรัพย์สิน: ${currentDevice}`;
document.getElementById('formModal').style.display = 'none'; // ซ่อน Modal หลัก
document.getElementById('assetModal').style.display = 'flex'; // แสดง Modal ทรัพย์สิน

// โหลดข้อมูล
await loadAssetData();
}

window.closeAssetModal = function(showMainModal = true) {
document.getElementById('assetModal').style.display = 'none';
if (showMainModal && currentDevice) {
document.getElementById('formModal').style.display = 'flex'; // 💥 FIX: ใช้ flex
} else {
// ถ้าไม่มี showMainModal หรือ currentDevice ให้ปิด overlay ไปเลย
closeForm();
}
}

async function loadAssetData() {
    const docRef = getSiteCollection(currentSiteKey).doc(currentDevice);
    const snap = await docRef.get();
    let assetInfo = {};
    if (snap.exists && snap.data().assetInfo) {
        assetInfo = snap.data().assetInfo;
    }

    // กำหนด ID ของช่อง Input ทั้งหมดในฟอร์มทรัพย์สิน
    const inputIds = [
        'assetSerial', 
        'assetModel', 
        'assetManufacturer', 
        'assetWarrantyStart', 
        'assetWarrantyEnd'
    ];

    // 💥 NEW: ตรวจสอบว่าเป็น Admin หรือไม่?
    // ถ้าไม่มี currentUser หรืออีเมลไม่ตรง ให้ถือว่าไม่ใช่ Admin
    const isAdmin = currentUser && currentUser.email === 'panattapon.sum@gmail.com';

    // วนลูปเพื่อล็อค/ปลดล็อค ช่องข้อมูล
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !isAdmin; // ถ้าไม่ใช่ Admin ให้ disable
            // เพิ่มสไตล์เพื่อให้รู้ว่ากรอกไม่ได้ (Optional)
            if (!isAdmin) {
                el.classList.add('bg-gray-700', 'text-gray-400', 'cursor-not-allowed');
            } else {
                el.classList.remove('bg-gray-700', 'text-gray-400', 'cursor-not-allowed');
            }
        }
    });

    // 💥 NEW: ซ่อน/แสดง ปุ่มบันทึกข้อมูลทรัพย์สิน
    const saveBtn = document.getElementById('saveAssetButton'); 
    if (saveBtn) {
        saveBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }

    // --- ส่วนการกำหนดค่าลงในฟอร์ม (เหมือนเดิม) ---
    document.getElementById('assetSerial').value = assetInfo.serial || '';
    document.getElementById('assetModel').value = assetInfo.model || '';
    document.getElementById('assetManufacturer').value = assetInfo.manufacturer || '';
    document.getElementById('assetWarrantyStart').value = assetInfo.warrantyStart || '';
    document.getElementById('assetWarrantyEnd').value = assetInfo.warrantyEnd || '';

    // คำนวณปี (ถ้ามี)
    if (assetInfo.warrantyStart && assetInfo.warrantyEnd) {
        const start = new Date(assetInfo.warrantyStart);
        const end = new Date(assetInfo.warrantyEnd);
        const diffYears = (end - start) / (1000 * 60 * 60 * 24 * 365.25);
        document.getElementById('assetWarrantyYears').value = Math.round(diffYears * 10) / 10; 
    } else {
        document.getElementById('assetWarrantyYears').value = '';
    }

    // อัปเดตสถานะที่แสดงในฟอร์ม
    updateAssetWarrantyStatusField();
}

window.saveAssetData = async function() {
    // ตรวจสอบการล็อคอิน
    if (!currentUser) {
        Swal.fire('ไม่ได้รับอนุญาต', 'กรุณาลงชื่อเข้าใช้ก่อนบันทึกข้อมูล', 'warning');
        return;
    }

    // 💥 NEW: ตรวจสอบอีเมลอนุญาต (Hard-coded Security Check) 💥
    const allowedEmail = 'panattapon.sum@gmail.com';
    if (currentUser.email !== allowedEmail) {
        Swal.fire({
            icon: 'error',
            title: 'ไม่มีสิทธิ์เข้าถึง',
            text: `เฉพาะบัญชี Admin เท่านั้น ที่ได้รับอนุญาตให้แก้ไขข้อมูลทรัพย์สิน`
        });
        return; // หยุดการทำงานทันที
    }

    if (!currentDevice) return;

    const assetInfo = {
        serial: document.getElementById('assetSerial').value,
        model: document.getElementById('assetModel').value,
        manufacturer: document.getElementById('assetManufacturer').value,
        warrantyStart: document.getElementById('assetWarrantyStart').value,
        warrantyEnd: document.getElementById('assetWarrantyEnd').value,
    };

    const docRef = getSiteCollection(currentSiteKey).doc(currentDevice);

    try {
        await docRef.set({ assetInfo }, { merge: true }); 
        Swal.fire('บันทึกสำเร็จ', 'ข้อมูลทรัพย์สินถูกบันทึกแล้ว', 'success');

        // อัปเดตหน้าจอหลัก (formModal)
        updateAssetDisplays(assetInfo);
        // อัปเดตตารางสรุป
        window.updateDeviceSummary();

        closeAssetModal(true); 
    } catch (e) {
        console.error("Error saving asset data:", e);
        Swal.fire('ผิดพลาด', 'ไม่สามารถบันทึกข้อมูลทรัพย์สินได้: ' + e.message, 'error');
    }
}

function updateAssetWarrantyStatusField() {
const endDate = document.getElementById('assetWarrantyEnd').value;
const status = getWarrantyStatus(endDate);
const field = document.getElementById('assetWarrantyStatus');

switch (status) {
case 'ok': field.value = 'รับประกัน'; break;
case 'warn': field.value = 'ใกล้หมดประกัน'; break;
case 'bad': field.value = 'หมดประกัน'; break;
default: field.value = 'N/A (ข้อมูลไม่ครบ)';
}
}

/**
* ตั้งค่าการคำนวณวันที่/ปี อัตโนมัติ
*/
function setupWarrantyCalculators() {
const startEl = document.getElementById('assetWarrantyStart');
const yearsEl = document.getElementById('assetWarrantyYears');
const endEl = document.getElementById('assetWarrantyEnd');

function calculateEnd() {
if (startEl.value && yearsEl.value) {
const startDate = new Date(startEl.value);
const years = parseFloat(yearsEl.value);
if (!isNaN(startDate) && years > 0) {
startDate.setFullYear(startDate.getFullYear() + Math.floor(years));
// จัดการส่วนทศนิยมของปี (ถ้ามี)
const fractionalDays = (years % 1) * 365.25;
startDate.setDate(startDate.getDate() + Math.round(fractionalDays));

endEl.value = startDate.toISOString().split('T')[0];
updateAssetWarrantyStatusField();
}
}
}

function calculateYears() {
if (startEl.value && endEl.value) {
const startDate = new Date(startEl.value);
const endDate = new Date(endEl.value);
if (!isNaN(startDate) && !isNaN(endDate) && endDate > startDate) {
const diffMs = endDate - startDate;
const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
yearsEl.value = Math.round(diffYears * 100) / 100; // ทศนิยม 2 ตำแหน่ง
updateAssetWarrantyStatusField();
}
}
}

startEl.addEventListener('change', calculateEnd);
yearsEl.addEventListener('change', calculateEnd);
endEl.addEventListener('change', calculateYears);
endEl.addEventListener('change', updateAssetWarrantyStatusField);
}

// 💥💥💥 FUNCTION: updateDeviceSummary (ฉบับแก้ไข: แสดงวันที่และสถานะถูกต้อง) 💥💥💥
window.updateDeviceSummary = async function() {
    const siteData = sites[currentSiteKey];
    if (!siteData) return;

    // Filter/Sort Parameters
    const search = document.getElementById('searchInput').value.toLowerCase();
    const sortOrder = document.getElementById('sortOrder').value;
    const filterStatus = document.getElementById('filterStatus').value;
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;

    const docsSnap = await getSiteCollection(currentSiteKey).get({ source: 'server' }); 
    const dataMap = {}; 
    docsSnap.forEach(d => dataMap[d.id] = d.data());

    let summary = [];

    for (const dev of siteData.devices) {
        const docData = dataMap[dev]; 
        const records = docData?.records || [];
        
        // เรียงข้อมูลตามเวลา (เก่า -> ใหม่)
        if (records.length > 0) {
            records.sort((a, b) => a.ts - b.ts); 
        }
        const latestRecord = records.length > 0 ? records[records.length - 1] : null;
        let downCount = docData?.downCount || 0; 

        // ✅ Helper: ฟังก์ชันเช็คว่า "ยังไม่ซ่อม" หรือไม่ (ใช้ Logic เดียวกับตอน Save)
        const isUnresolved = (r) => {
            if (r.status !== 'down') return false;
            return !r.fixedDate || r.fixedDate === '' || r.fixedDate === '-' || r.fixedDate === 'null';
        };

        // 💥 NEW: คำนวณคงเหลือ (ใช้ Helper)
        const remainingDownRecords = records.filter(r => isUnresolved(r));
        const remainingDownCount = remainingDownRecords.length;

        // --- Downtime Calculation & Display Logic ---
        let latestBrokenDuration = '-';
        let latestBrokenDays = 0;
        let earliestBrokenDate = '-';
        let latestFixedDate = '-'; // ค่าเริ่มต้นคือยังไม่ซ่อม
        let currentStatusDisplay = 'ok'; // ค่าเริ่มต้น

        // 💥 NEW LOGIC: ตรวจสอบว่ามีรายการค้างหรือไม่?
        if (remainingDownCount > 0) {
            // กรณี 1: มีรายการชำรุดค้างอยู่ (อย่างน้อย 1 รายการ)
            currentStatusDisplay = '❎ ชำรุด';

            // หา "วันที่ชำรุด" ที่เก่าที่สุด ของรายการที่ยังไม่ซ่อม
            // (remainingDownRecords ถูกเรียงจาก เก่า->ใหม่ อยู่แล้ว เพราะ records หลักเรียงมาแล้ว)
            const oldestIssue = remainingDownRecords[0]; 

            earliestBrokenDate = oldestIssue.brokenDate || '-';
            
            // วันที่ซ่อมแซม: บังคับเป็น '-' เพราะยังซ่อมไม่หมด
            latestFixedDate = '-'; 

            // คำนวณระยะเวลาจากตัวที่เก่าที่สุดถึงปัจจุบัน
            latestBrokenDays = calculateDaysDifference(earliestBrokenDate, null);
            latestBrokenDuration = formatDuration(latestBrokenDays) + ' (ยังไม่ได้แก้ไข)';

        } else {
            // กรณี 2: ซ่อมครบหมดแล้ว หรือไม่มีรายการชำรุดเลย
            currentStatusDisplay = '✅ ใช้งานได้'; 

            if (latestRecord && latestRecord.brokenDate) {
                 // แสดงประวัติจากรายการล่าสุด (ที่จบไปแล้ว)
                 earliestBrokenDate = latestRecord.brokenDate;
                 latestFixedDate = latestRecord.fixedDate || '-'; 

                 if (latestRecord.fixedDate && latestRecord.fixedDate !== '-') {
                      latestBrokenDays = calculateDaysDifference(latestRecord.brokenDate, latestRecord.fixedDate);
                      latestBrokenDuration = formatDuration(latestBrokenDays);
                 }
            }
        }
        
        // --- การกรองข้อมูล (Filter Logic) ---
        let dateFilterSource = earliestBrokenDate !== '-' ? earliestBrokenDate : (latestRecord?.brokenDate);

        if (dateFilterSource && dateFilterSource !== '-') {
            const latestTs = new Date(dateFilterSource).getTime();
            if (from) {
                const fromTs = new Date(from).getTime();
                if (latestTs < fromTs) continue;
            }
            if (to) {
                const toTs = new Date(to).getTime() + (1000 * 60 * 60 * 24); 
                if (latestTs >= toTs) continue;
            }
        }        

        if (filterStatus === 'currently-down' && remainingDownCount === 0) continue; 
        if (filterStatus === 'down' && downCount === 0) continue; 
        if (filterStatus === 'clean' && downCount > 0) continue; 
        if (search && !dev.toLowerCase().includes(search)) continue;

        summary.push({
            device: dev,
            count: downCount,
            remaining: remainingDownCount, // แสดงจำนวนคงเหลือที่คำนวณใหม่
            brokenDate: earliestBrokenDate,
            fixedDate: latestFixedDate,
            status: currentStatusDisplay,
            latestDescription: latestRecord?.description || '-',
            latestBrokenDuration: latestBrokenDuration,
            latestBrokenDays: latestBrokenDays,
        });
    }

    // --- Sorting Logic ---
    summary.sort((a, b) => {
        const countSort = sortOrder === 'desc' ? b.count - a.count : a.count - b.count;
        if (countSort !== 0) return countSort;
        // เรียงตามระยะเวลาที่เสีย (มาก -> น้อย)
        return b.latestBrokenDays - a.latestBrokenDays; 
    });

    // --- Rendering ---
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(summary.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageData = summary.slice(startIndex, endIndex);

    const tbody = document.getElementById('summaryBody');
    tbody.innerHTML = '';

    if (summary.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-400">ไม่พบข้อมูลอุปกรณ์ตามเงื่อนไขที่เลือก</td></tr>'; 
    } else {
        pageData.forEach(s => {
            const tr = document.createElement('tr');
            tr.className = 'border-t border-white/10 hover:bg-white/5 cursor-pointer'; 
            tr.innerHTML = `
                <td class="text-left font-medium">${escapeHtml(s.device)}</td>
                <td><span class="${s.count > 0 ? 'tag tag-bad' : 'tag tag-ok'}">${s.count} / ${s.remaining}</span></td> 
                <td>${s.brokenDate}</td>
                <td>${s.fixedDate}</td>
                <td><span class="${s.status.includes('ชำรุด') ? 'tag tag-bad' : 'tag tag-ok'}">${s.status}</span></td>
                <td class="font-semibold text-center">${s.latestBrokenDuration}</td>
                <td class="text-left text-sm text-gray-300 max-w-[200px] whitespace-normal">${escapeHtml(s.latestDescription || '-')}</td>
            `;
            tr.addEventListener('click', () => window.openForm(s.device)); 
            tbody.appendChild(tr);
        });
    }

    // Pagination controls
    document.getElementById('pagination').innerHTML = `
        <div class="flex justify-center items-center gap-2 mt-2">
            <button class="btn" onclick="changePage(-1)" ${currentPage===1?'disabled':''}>⬅️ ก่อนหน้า</button>
            <span>หน้า ${currentPage} / ${totalPages}</span>
            <button class="btn" onclick="changePage(1)" ${currentPage===totalPages?'disabled':''}>ถัดไป ➡️</button>
        </div>
    `;

    updateChart(summary);
};


function updateChart(summary) {
const sorted = [...summary].sort((a, b) => b.count - a.count);
const top10 = sorted.slice(0, 10);
const labels = top10.map(s => s.device);
const data = top10.map(s => s.count);
if (chartInstance) chartInstance.destroy();
const ctx = document.getElementById('chart').getContext('2d');
// Assume Chart.js is loaded
chartInstance = new Chart(ctx, {
type: 'bar',
data: { labels, datasets: [{ label: 'ครั้งชำรุด', data, backgroundColor: data.map(v => v > 0 ? 'rgba(248,113,113,0.85)' : 'rgba(148,163,184,0.6)') }] },
options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, precision: 0 } } }
});
}

window.changePage = function(step) {
currentPage += step;
if (currentPage < 1) currentPage = 1;
window.updateDeviceSummary(); 
}

// =========================================================================
// Topology Map and Overlays
// =========================================================================

window.updateDeviceStatusOverlays = async function(siteKey) {
const mapContainer = document.getElementById(`map-${siteKey}`);
if (!mapContainer) return;

const imgElement = mapContainer.querySelector('img');
if (!imgElement) return;

// 1. ลบ Overlay เก่าทั้งหมดออก
mapContainer.querySelectorAll('.device-overlay').forEach(el => el.remove());

// 2. ดึงข้อมูลอุปกรณ์ที่ 'down'
const docsSnap = await getAllDevicesDocs(siteKey);
const downDevices = {};
docsSnap.forEach(d => {
const data = d.data();
if (data && data.currentStatus === 'down') {
downDevices[d.id] = true;
}
});

// 3. ค้นหา Map Area และสร้าง Overlay
const mapElement = mapContainer.querySelector('map');
if (!mapElement) return;

const areaElements = mapElement.querySelectorAll('area');

const MIN_DIMENSION = 10; 

// ใช้ค่าชดเชยตามที่เคยกำหนด (แม่สะเรียง +25px)
const OFFSET_TOP = (siteKey === 'mae-sariang' || siteKey === 'betong') ? 25 : 0;

areaElements.forEach(area => {
const deviceName = area.getAttribute('alt');
if (downDevices[deviceName]) {
// พบอุปกรณ์ชำรุดที่ตรงกับ Area ในแผนที่
const coords = area.getAttribute('coords').split(',').map(c => parseInt(c.trim()));
const shape = area.getAttribute('shape');

let x, y, width, height;

if (shape === 'rect' && coords.length === 4) {
x = coords[0];
y = coords[1];
width = coords[2] - coords[0];
height = coords[3] - coords[1];

width = Math.max(width, MIN_DIMENSION);
height = Math.max(height, MIN_DIMENSION);

} else {
return;
}

const overlay = document.createElement('div');
overlay.className = 'device-overlay down';

const PADDING = 2; // ขนาดของขอบวงกลมรอบอุปกรณ์

overlay.style.left = `${x - PADDING}px`;
// ใช้ OFFSET_TOP เพื่อชดเชยตำแหน่ง
overlay.style.top = `${y - PADDING + OFFSET_TOP}px`; 
overlay.style.width = `${width + (2 * PADDING)}px`;
overlay.style.height = `${height + (2 * PADDING)}px`;

overlay.setAttribute('title', deviceName);

mapContainer.appendChild(overlay);
}
});
}

// =========================================================================
// Realtime Listener, Import/Export
// =========================================================================

let unsubscribe = null; // ตัวแปรสำหรับเก็บฟังก์ชันยกเลิกการติดตาม

function setupRealtimeListener(siteKey) {
if (unsubscribe) {
unsubscribe(); // Stop the previous listener
}

// Listener ชี้ไปที่ Collection ของไซต์งานปัจจุบัน
const currentDeviceCollection = db.collection(`sites`).doc(siteKey).collection(`devices`); 

unsubscribe = currentDeviceCollection.onSnapshot(snapshot => { 
// เมื่อข้อมูลเปลี่ยนแปลงในไซต์ปัจจุบัน จะเรียกฟังก์ชันสรุปผล
window.updateDeviceSummary(); 

}, (error) => {
console.error("Firestore Realtime Listener Error:", error);
// 💥 MODIFIED: เปิดใช้งาน SweetAlert2 💥
Swal.fire('ข้อผิดพลาด', 'ไม่สามารถเชื่อมต่อฐานข้อมูลแบบเรียลไทม์ได้: ' + error.message, 'error');
});
}

// 💥💥💥 FUNCTION: processAndSaveImport (ฉบับแก้ไข: ตรวจสอบรายการค้างแม่นยำขึ้น) 💥💥💥
async function processAndSaveImport(assetsToImport, recordsToImport) {
    Swal.fire({
        title: 'กำลังนำเข้า...',
        text: 'กำลังประมวลผลและบันทึกข้อมูล...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    const batch = db.batch();
    const assetMap = new Map();
    for (const item of assetsToImport) assetMap.set(item.deviceName, item.assetInfo);

    const recordMap = new Map(); 
    for (const item of recordsToImport) {
        if (!recordMap.has(item.deviceName)) recordMap.set(item.deviceName, []);
        recordMap.get(item.deviceName).push(item.record);
    }

    const allDeviceNames = new Set([...assetMap.keys(), ...recordMap.keys(), ...sites[currentSiteKey].devices]);

    try {
        const docsSnap = await getAllDevicesDocs(currentSiteKey);
        const existingDataMap = new Map();
        docsSnap.forEach(d => existingDataMap.set(d.id, d.data()));

        for (const deviceName of allDeviceNames) {
            if (!sites[currentSiteKey].devices.includes(deviceName)) continue;

            const docRef = getSiteCollection(currentSiteKey).doc(deviceName);
            const existingData = existingDataMap.get(deviceName) || {};

            let finalAssetInfo = existingData.assetInfo || {};
            if (assetMap.has(deviceName)) finalAssetInfo = assetMap.get(deviceName);

            const existingRecords = existingData.records || [];
            const importedRecords = recordMap.get(deviceName) || [];

            const finalRecordsMap = new Map();
            for (const r of existingRecords) finalRecordsMap.set(r.ts, r);
            for (const r of importedRecords) finalRecordsMap.set(r.ts, r);

            const finalRecords = Array.from(finalRecordsMap.values());
            finalRecords.sort((a, b) => a.ts - b.ts);

            const downCount = finalRecords.filter(r => r.counted).length; 
            
            // ✅ Helper: ฟังก์ชันเช็คว่า "ยังไม่ซ่อม" หรือไม่ (รวมทุกเงื่อนไข)
            const isUnresolved = (r) => {
                if (r.status !== 'down') return false; // ต้องสถานะ down ก่อน
                // ถ้าไม่มีวันที่ซ่อม หรือ วันที่ซ่อมเป็นค่าว่าง/- ให้ถือว่ายังไม่ซ่อม
                return !r.fixedDate || r.fixedDate === '' || r.fixedDate === '-' || r.fixedDate === 'null';
            };

            // 💥 FIXED Logic: ใช้ Helper ในการกรอง
            const remainingDownRecords = finalRecords.filter(r => isUnresolved(r));
            
            let currentStatus = 'ok';
            if (remainingDownRecords.length > 0) {
                currentStatus = 'down'; // ถ้ามีค้าง ให้สถานะเป็น down เสมอ
            } else {
                // ถ้าไม่มีค้าง ให้ดูรายการล่าสุด
                const latestRecord = finalRecords.length > 0 ? finalRecords[finalRecords.length - 1] : null;
                currentStatus = latestRecord ? latestRecord.status : 'ok';
            }

            batch.set(docRef, {
                assetInfo: finalAssetInfo,
                records: finalRecords,
                downCount: downCount,
                currentStatus: currentStatus
            }); 
        }

        await batch.commit();
        window.updateDeviceSummary();
        window.updateDeviceStatusOverlays(currentSiteKey);

        Swal.fire({
            title: 'นำเข้าสำเร็จ!',
            text: `ประมวลผลข้อมูลเรียบร้อย`,
            icon: 'success',
            confirmButtonText: 'ตกลง'
        });

    } catch (error) {
        console.error("Error processing import batch: ", error);
        Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + error.message, 'error');
    }
}

// 💥💥💥 FUNCTION `importData` (แก้ไขการจัดการวันที่) 💥💥💥
window.importData = function(event) {
    if (!currentUser) {
        Swal.fire('ไม่ได้รับอนุญาต', 'กรุณาลงชื่อเข้าใช้ก่อนนำเข้าข้อมูล', 'warning');
        event.target.value = null;
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });

            const assetSheetName = "ข้อมูลทรัพย์สิน";
            const recordSheetName = "ประวัติการชำรุด";

            const wsAssets = wb.Sheets[assetSheetName];
            const wsRecords = wb.Sheets[recordSheetName];

            if (!wsAssets && !wsRecords) {
                Swal.fire('ผิดพลาด', 'ไม่พบชีต "ข้อมูลทรัพย์สิน" หรือ "ประวัติการชำรุด" ในไฟล์ Excel', 'error');
                event.target.value = null;
                return;
            }

            const assetsToImport = [];
            const recordsToImport = [];

            // --- Helper: ล้างข้อมูลวันที่ให้เป็น Null ถ้าไม่มีค่าจริง ---
            const cleanDate = (val) => {
                if (!val) return null;
                const str = val.toString().trim();
                if (str === '-' || str === '' || str.toLowerCase() === 'null') return null;
                // ตัดให้เหลือแค่ YYYY-MM-DD และเปลี่ยน / เป็น -
                return str.slice(0, 10).replace(/\//g, '-');
            };

            // --- 1. ประมวลผลชีต "ข้อมูลทรัพย์สิน" ---
            if (wsAssets) {
                const assetRawData = XLSX.utils.sheet_to_json(wsAssets, { header: 1 });
                if (assetRawData.length >= 2) { 
                    const headers = assetRawData[0];
                    const headerMap = {
                        'ชื่ออุปกรณ์': headers.indexOf('ชื่ออุปกรณ์'),
                        'Serial Number': headers.indexOf('Serial Number'),
                        'Model': headers.indexOf('Model'),
                        'Manufacturer': headers.indexOf('Manufacturer'),
                        'วันที่เริ่มประกัน': headers.indexOf('วันที่เริ่มประกัน'),
                        'วันที่หมดประกัน': headers.indexOf('วันที่หมดประกัน'),
                    };

                    if (headerMap['ชื่ออุปกรณ์'] !== -1) {
                        for (let i = 1; i < assetRawData.length; i++) {
                            const row = assetRawData[i];
                            const deviceName = row[headerMap['ชื่ออุปกรณ์']];
                            if (!deviceName) continue;

                            const assetInfo = {
                                serial: row[headerMap['Serial Number']] || '',
                                model: row[headerMap['Model']] || '',
                                manufacturer: row[headerMap['Manufacturer']] || '',
                                warrantyStart: cleanDate(row[headerMap['วันที่เริ่มประกัน']]),
                                warrantyEnd: cleanDate(row[headerMap['วันที่หมดประกัน']]),
                            };
                            assetsToImport.push({ deviceName, assetInfo });
                        }
                    }
                }
            }

            // --- 2. ประมวลผลชีต "ประวัติการชำรุด" ---
            if (wsRecords) {
                const recordRawData = XLSX.utils.sheet_to_json(wsRecords, { header: 1 });
                if (recordRawData.length >= 2) { 
                    const headers = recordRawData[0];
                    const headerMap = {
                        'Timestamp': headers.indexOf('Timestamp'),
                        'ชื่ออุปกรณ์': headers.indexOf('ชื่ออุปกรณ์'),
                        'วันที่ชำรุด': headers.indexOf('วันที่ชำรุด'),
                        'วันที่ซ่อมแซม': headers.indexOf('วันที่ซ่อมแซม'),
                        'สถานะ': headers.indexOf('สถานะ'),
                        'คำอธิบาย': headers.indexOf('คำอธิบาย'),
                        'ผู้บันทึก': headers.indexOf('ผู้บันทึก')
                    };

                    const requiredHeaders = ['ชื่ออุปกรณ์', 'วันที่ชำรุด', 'สถานะ'];
                    if (!requiredHeaders.some(h => headerMap[h] === -1)) {
                        for (let i = 1; i < recordRawData.length; i++) {
                            const row = recordRawData[i];
                            const deviceName = row[headerMap['ชื่ออุปกรณ์']];
                            if (!deviceName) continue;

                            // จัดการวันที่ด้วย cleanDate
                            const importedBrokenDate = cleanDate(row[headerMap['วันที่ชำรุด']]);
                            const importedFixedDate = cleanDate(row[headerMap['วันที่ซ่อมแซม']]);
                            
                            const statusValue = (row[headerMap['สถานะ']] || '').toString();
                            const importedTs = row[headerMap['Timestamp']];
                            
                            // กำหนดสถานะเบื้องต้นจาก Excel
                            let finalStatus = statusValue.includes('ชำรุด') ? 'down' : 'ok';

                            // 💥 Logic สำคัญ: ถ้ามีวันชำรุด แต่ไม่มีวันซ่อม ให้ถือว่าชำรุด (down) เสมอ
                            if (importedBrokenDate && !importedFixedDate) {
                                finalStatus = 'down';
                            }

                            const record = {
                                ts: importedTs ? parseInt(importedTs) : Date.now() + i,
                                brokenDate: importedBrokenDate || '',
                                fixedDate: importedFixedDate || null, // ส่ง Null ชัดเจนถ้าไม่มี
                                status: finalStatus, 
                                description: (row[headerMap['คำอธิบาย']] || '').toString() || 'นำเข้าจาก Excel',
                                user: (row[headerMap['ผู้บันทึก']] || '').toString() || currentUser.email,
                                counted: !!importedBrokenDate, 
                            };

                            recordsToImport.push({ deviceName, record });
                        }
                    }
                }
            }

            // --- 3. เรียกฟังก์ชันประมวลผล ---
            if (assetsToImport.length > 0 || recordsToImport.length > 0) {
                processAndSaveImport(assetsToImport, recordsToImport);
            } else {
                Swal.fire('ผิดพลาด', 'ไม่พบข้อมูลที่ถูกต้องในชีตใดๆ', 'error');
            }

        } catch (error) {
            console.error("Import Error: ", error);
            Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการอ่านไฟล์: ' + error.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = null; 
};

// 💥💥💥 FUNCTION `exportAllDataExcel` (แก้ไข) 💥💥💥
window.exportAllDataExcel = async function() {
const siteData = sites[currentSiteKey];
if (!siteData || siteData.devices.length === 0) {
Swal.fire('แจ้งเตือน', 'ไม่พบอุปกรณ์ในไซต์งานปัจจุบันสำหรับการส่งออก', 'warning');
return;
}

const docsSnap = await getAllDevicesDocs(currentSiteKey);
const dataMap = {};
docsSnap.forEach(d => dataMap[d.id] = d.data());

// --- 💥 Sheet 1: Device Records (ประวัติการชำรุด) ---
const recordsHeader = [
'Timestamp', 
'ชื่ออุปกรณ์', 
'ลำดับการชำรุด (ครั้งที่ N)', // 💥 NEW: เพิ่มคอลัมน์ลำดับ
'วันที่ชำรุด', 
'วันที่ซ่อมแซม', 
'ระยะเวลาชำรุด', 
'สถานะ', 
'คำอธิบาย', 
'ผู้บันทึก' 
];
const recordsData = [recordsHeader]; // เริ่มด้วย Header

// --- 💥 Sheet 2: Asset Information (ข้อมูลทรัพย์สิน) ---
const assetHeader = [
'ชื่ออุปกรณ์', 
'Serial Number', 
'Model', 
'Manufacturer', 
'วันที่เริ่มประกัน', 
'วันที่หมดประกัน',
'สถานะประกัน'
];
const assetData = [assetHeader]; // เริ่มด้วย Header

// --- วนลูปอุปกรณ์ทั้งหมดใน Site นี้ ---
for (const devName of siteData.devices) {
const docData = dataMap[devName];

// --- 1. เตรียมข้อมูลสำหรับ Sheet 2 (Assets) ---
const assetInfo = docData?.assetInfo || {}; // ดึงข้อมูลทรัพย์สิน

// คำนวณสถานะประกันเพื่อแสดงผล
const warrantyStatus = getWarrantyStatus(assetInfo.warrantyEnd);
let warrantyStatusText = 'N/A (ไม่ระบุ)';
switch(warrantyStatus) {
case 'ok': warrantyStatusText = 'รับประกัน'; break;
case 'warn': warrantyStatusText = 'ใกล้หมดประกัน'; break;
case 'bad': warrantyStatusText = 'หมดประกัน'; break;
}

// เพิ่ม 1 แถวสำหรับอุปกรณ์นี้ลงใน assetData
assetData.push([
devName,
assetInfo.serial || '-',
assetInfo.model || '-',
assetInfo.manufacturer || '-',
// 💥 FIX: แปลง - เป็น / 💥
(assetInfo.warrantyStart || '-').replace(/-/g, '/'), 
(assetInfo.warrantyEnd || '-').replace(/-/g, '/'),   
warrantyStatusText
]);

// --- 2. เตรียมข้อมูลสำหรับ Sheet 1 (Records) ---
if (!docData) {
continue; // ข้ามไปอุปกรณ์ถัดไปถ้าไม่มีข้อมูล (แต่ asset ถูกเพิ่มไปแล้ว)
}

const records = docData.records || [];

// 💥 NEW: เรียงลำดับ records จากเก่าไปใหม่ (เพื่อคำนวณลำดับชำรุด)
records.sort((a, b) => a.ts - b.ts);

let downCount = 0; // ตัวนับลำดับการชำรุด (เริ่มใหม่สำหรับแต่ละอุปกรณ์)

// วนลูปทุกประวัติของอุปกรณ์นี้
records.forEach(r => {
let duration = '-';
let sequenceNumber = '-'; // ค่าเริ่มต้น

// 💥 NEW: ตรวจสอบและนับเฉพาะรายการที่ถูก 'counted' (ถือเป็นการชำรุดที่ถูกนับ)
if (r.counted) {
downCount++; 
sequenceNumber = downCount; // ครั้งที่ 1, 2, 3...
}

if (r.brokenDate) {
if (r.fixedDate) {
const days = calculateDaysDifference(r.brokenDate, r.fixedDate);
duration = formatDuration(days);
} else if (r.status === 'down') {
const days = calculateDaysDifference(r.brokenDate, null); 
duration = formatDuration(days) + ' (ชำรุด)';
}
}

// เพิ่ม 1 แถวต่อ 1 record ลงใน recordsData
recordsData.push([
r.ts || '-', 
devName,
sequenceNumber, // 💥 NEW: ใส่ลำดับที่คำนวณได้
// 💥 FIX: แปลง - เป็น / 💥
(r.brokenDate || '-').replace(/-/g, '/'), 
(r.fixedDate || '-').replace(/-/g, '/'),  
duration, 
r.status === 'down' ? 'ชำรุด' : 'ใช้งานได้',
r.description || '-',
r.user || '-', 
]);
});
}

// --- ตรวจสอบว่ามีข้อมูลให้ส่งออกหรือไม่ ---
if (recordsData.length <= 1 && assetData.length <= 1) {
Swal.fire('แจ้งเตือน', 'ไม่พบข้อมูลใดๆ ในไซต์งานปัจจุบันสำหรับการส่งออก', 'warning');
return;
}

// --- 💥 สร้าง Workbook และเพิ่มชีตทั้งสอง ---
const wb = XLSX.utils.book_new();

// สร้าง Sheet 1 (Records)
if (recordsData.length > 1) { // เพิ่มชีตเฉพาะเมื่อมีข้อมูล (มากกว่าแถว Header)
const ws_records = XLSX.utils.aoa_to_sheet(recordsData);
XLSX.utils.book_append_sheet(wb, ws_records, "ประวัติการชำรุด"); // 👈 ชื่อชีตที่ 1
}

// สร้าง Sheet 2 (Assets)
if (assetData.length > 1) { // เพิ่มชีตเฉพาะเมื่อมีข้อมูล
const ws_assets = XLSX.utils.aoa_to_sheet(assetData);
XLSX.utils.book_append_sheet(wb, ws_assets, "ข้อมูลทรัพย์สิน"); // 👈 ชื่อชีตที่ 2
}

// --- สร้างและดาวน์โหลดไฟล์ ---
const fileName = `Device_Export_${siteData.name.replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
XLSX.writeFile(wb, fileName);

Swal.fire('ส่งออกสำเร็จ', `ไฟล์ ${fileName} ถูกบันทึกแล้ว (มี 2 ชีต)`, "success");
};

function resetFilters() {
document.getElementById('searchInput').value = '';
document.getElementById('sortOrder').value = 'desc';
document.getElementById('filterStatus').value = 'all';
document.getElementById('fromDate').value = '';
document.getElementById('toDate').value = '';
currentPage = 1;
try { window.updateDeviceSummary(); } catch (e) {} 
}

window.resetFilters = resetFilters;

window.clearAllDevices = async function() {
// 💥 MODIFIED: Check Auth 💥
if (!currentUser) {
Swal.fire('ไม่ได้รับอนุญาต', 'กรุณาลงชื่อเข้าใช้ก่อน', 'warning');
return;
}

// 💡 ใช้ SweetAlert2
const result = await Swal.fire({
title: '⚠️ ลบข้อมูลทั้งหมด?',
text: `คุณแน่ใจหรือไม่ว่าต้องการล้างข้อมูลทั้งหมดของไซต์ ${sites[currentSiteKey].name}? ข้อมูลทรัพย์สิน (Serial, Model) จะไม่ถูกลบ`,
icon: 'error',
showCancelButton: true,
confirmButtonColor: '#ef4444',
cancelButtonColor: '#6b7280',
confirmButtonText: 'ใช่, ลบทั้งหมด!',
cancelButtonText: 'ยกเลิก'
});

if (result.isConfirmed) {
const docs = await getAllDevicesDocs(currentSiteKey);
const batch = db.batch(); 

for (let d of docs.docs) {
const docRef = getSiteCollection(currentSiteKey).doc(d.id);
// 💡 ใช้ merge: true เพื่อไม่ให้ลบ assetInfo
batch.set(docRef, { records: [], downCount: 0, currentStatus: 'ok' }, { merge: true });
}
await batch.commit();

window.updateDeviceSummary(); 
window.updateDeviceStatusOverlays(currentSiteKey); 
Swal.fire('ลบเรียบร้อย', 'ลบข้อมูลประวัติทั้งหมดแล้ว', 'success');
}
}

// สลับหน้า
window.showSummary = function() {
document.getElementById('topologyPage').classList.add('hidden');
document.getElementById('summaryPage').classList.remove('hidden');
window.updateDeviceSummary(); 
};

window.showTopology = function() {
document.getElementById('summaryPage').classList.add('hidden');
document.getElementById('topologyPage').classList.remove('hidden');
if (typeof imageMapResize === 'function') {
imageMapResize();
}
window.updateDeviceStatusOverlays(currentSiteKey);
};

function switchSite(siteKey) {
const siteData = sites[siteKey];
if (!siteData) return;
currentSiteKey = siteKey;
document.getElementById('locationTitle').textContent = `🔎 ${siteData.name}`;
document.querySelectorAll('.map-container').forEach(el => el.classList.add('hidden'));
document.getElementById(`map-${siteKey}`).classList.remove('hidden');

if (typeof imageMapResize === 'function') {
imageMapResize();
}
setupRealtimeListener(siteKey); // ตั้งค่า Listener ใหม่
window.updateDeviceStatusOverlays(currentSiteKey); 
}

// =========================================================================
// Initialization
// =========================================================================

document.addEventListener("DOMContentLoaded", function() {

// --- 1. Auth State Change Listener ---
auth.onAuthStateChanged(user => {
if (user) {
// ผู้ใช้ล็อคอินแล้ว
currentUser = user;
document.getElementById('userInfo').classList.remove('hidden');
document.getElementById('loginButton').classList.add('hidden');
// 💥 FIX 1.3: ใช้ email
document.getElementById('userNameDisplay').textContent = `${user.email}`; 
toggleWriteAccess(true);
} else {
// ผู้ใช้ออกจากระบบ
currentUser = null;
document.getElementById('userInfo').classList.add('hidden');
document.getElementById('loginButton').classList.remove('hidden');
toggleWriteAccess(false);
}
});

// --- 2. Auth Button Listeners ---
document.getElementById('loginButton').addEventListener('click', login);
document.getElementById('logoutButton').addEventListener('click', logout);

// --- 3. Warranty Calculator Setup ---
setupWarrantyCalculators();

// --- 4. Site Switcher Setup ---
const locationSelect = document.getElementById("location-select");

if (!locationSelect) {
console.error("Error: Element with ID 'location-select' not found.");
return; 
}

locationSelect.addEventListener("change", function() {
switchSite(this.value);
});

try {
let initialSiteKey = locationSelect.value;
const siteKeys = Object.keys(sites);

if (!initialSiteKey || !sites[initialSiteKey]) {
if (siteKeys.length > 0) {
initialSiteKey = siteKeys[0];
locationSelect.value = initialSiteKey; 
} else {
console.warn("No sites defined in the 'sites' object.");
return;
}
}

// เริ่มต้นด้วยการปิดการเขียนข้อมูล (จนกว่า auth.onAuthStateChanged จะทำงาน)
toggleWriteAccess(false); 
switchSite(initialSiteKey); 

} catch (error) {
console.error("Initial Site Switch Error:", error);
Swal.fire('ข้อผิดพลาด', 'เกิดข้อผิดพลาดในการเริ่มต้นระบบ: ' + error.message, 'error');
}
});

// 💥💥💥 PDF REPORT FUNCTION (Print Mode) 💥💥💥
window.printReport = async function() {
    const siteData = sites[currentSiteKey];
    
    // ดึงข้อมูลล่าสุดมาคำนวณ
    const docsSnap = await getSiteCollection(currentSiteKey).get();
    const dataMap = {};
    docsSnap.forEach(d => dataMap[d.id] = d.data());

    let reportRows = '';
    let itemNo = 1;

    // สร้างตารางข้อมูล
    for (const dev of siteData.devices) {
        const docData = dataMap[dev] || {};
        const records = docData.records || [];
        records.sort((a, b) => a.ts - b.ts);
        
        // คำนวณสถานะ (Logic เดียวกับ updateDeviceSummary)
        const isUnresolved = (r) => r.status === 'down' && (!r.fixedDate || r.fixedDate === '' || r.fixedDate === '-');
        const remainingDownRecords = records.filter(r => isUnresolved(r));
        const remaining = remainingDownRecords.length;
        
        const assetInfo = docData.assetInfo || {};
        const statusText = remaining > 0 ? '<span style="color:red; font-weight:bold;">❎ ชำรุด</span>' : '<span style="color:green;">✅ ใช้งานได้</span>';
        
        // หาวันที่ชำรุดล่าสุด/เก่าสุดตาม Logic
        let dateInfo = '-';
        if (remaining > 0) {
            const oldest = remainingDownRecords[0]; // ตัวเก่าสุดที่ค้าง
            dateInfo = `ชำรุดเมื่อ: ${oldest.brokenDate} (ค้าง ${remaining} รายการ)`;
        } else if (records.length > 0) {
            const last = records[records.length-1];
            if (last.fixedDate) dateInfo = `ซ่อมล่าสุด: ${last.fixedDate}`;
        }

        reportRows += `
            <tr style="border-bottom: 1px solid #ddd;">
                <td style="padding: 8px; text-align: center;">${itemNo++}</td>
                <td style="padding: 8px;">
                    <strong>${dev}</strong><br>
                    <span style="font-size: 12px; color: #666;">Model: ${assetInfo.model || '-'} | S/N: ${assetInfo.serial || '-'}</span>
                </td>
                <td style="padding: 8px; text-align: center;">${statusText}</td>
                <td style="padding: 8px; text-align: center;">${docData.downCount || 0}</td>
                <td style="padding: 8px;">${dateInfo}</td>
            </tr>
        `;
    }

    // สร้างหน้า HTML สำหรับพิมพ์
    const printWindow = window.open('', '', 'height=800,width=1000');
    printWindow.document.write(`
        <html>
        <head>
            <title>รายงานสถานะอุปกรณ์ - ${siteData.name}</title>
            <style>
                body { font-family: 'Sarabun', sans-serif; padding: 20px; }
                h1 { text-align: center; margin-bottom: 5px; }
                h3 { text-align: center; color: #555; margin-top: 0; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th { background-color: #f2f2f2; border: 1px solid #ddd; padding: 10px; text-align: left; }
                td { border: 1px solid #ddd; }
                .footer { margin-top: 30px; text-align: right; font-size: 12px; color: #888; }
                @media print {
                    .no-print { display: none; }
                    body { -webkit-print-color-adjust: exact; }
                }
            </style>
            <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet">
        </head>
        <body>
            <h1>📄 รายงานสรุปสถานะอุปกรณ์</h1>
            <h3>โครงการ: ${siteData.name}</h3>
            <p><strong>วันที่ออกรายงาน:</strong> ${new Date().toLocaleString('th-TH')}</p>
            
            <table>
                <thead>
                    <tr>
                        <th style="width: 50px; text-align: center;">ลำดับ</th>
                        <th>ชื่ออุปกรณ์ / รายละเอียดทรัพย์สิน</th>
                        <th style="width: 100px; text-align: center;">สถานะ</th>
                        <th style="width: 80px; text-align: center;">ครั้งที่ชำรุด</th>
                        <th>รายละเอียดวันที่</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportRows}
                </tbody>
            </table>

            <div class="footer">
                ออกรายงานโดยระบบ Microgrid Maintenance Tracking<br>
                ผู้พิมพ์: ${currentUser ? currentUser.email : 'Guest'}
            </div>

            <script>
                // สั่งพิมพ์อัตโนมัติเมื่อโหลดเสร็จ
                window.onload = function() { window.print(); window.close(); }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
};
async function sendDiscordNotify(deviceName, description, user) {
    // URL เดิมจาก Google Apps Script ของคุณ
    const GAS_URL = "https://script.google.com/macros/s/AKfycbwMMbSEA1SI3m4WRe1bkwh7gxFbIHdqfdnk2ENVUEohVKyl1eiNXZwCWWs6tBw48f9G9A/exec"; 

    const message = `
🚨 **แจ้งเตือนอุปกรณ์ชำรุด**
📍 **สถานที่:** ${sites[currentSiteKey].name}
🛠️ **อุปกรณ์:** ${deviceName}
📝 **อาการ:** ${description || '-'}
👤 **ผู้แจ้ง:** ${user}
🕒 **เวลา:** ${new Date().toLocaleString('th-TH')}
------------------------------------------
    `;

    try {
        // 💥 MODIFIED: เพิ่ม &site=${currentSiteKey} ต่อท้าย body เพื่อบอกว่าส่งมาจากที่ไหน
        await fetch(GAS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `message=${encodeURIComponent(message)}&site=${encodeURIComponent(currentSiteKey)}`
        });
        console.log(`Discord Notification sent to ${currentSiteKey}!`);
    } catch (e) {
        console.error("Failed to send Discord:", e);
    }
}
window.onload = function() {
try { imageMapResize(); } catch (e) {}
	
};











