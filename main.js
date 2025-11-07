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

firebase.initializeApp(firebaseConfig); 
const db = firebase.firestore();
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
db.settings({
  // บังคับให้ใช้ Long Polling แทน QUIC เพื่อหลีกเลี่ยงปัญหาเครือข่าย/ไฟร์วอลล์
  experimentalForceLongPolling: true,
});
const devicesCol = db.collection("devices"); // 💡 Not used globally in this structure, but kept for context

const sites = {
    "ko-phaluay": {
        name: "ไมโครกริดเกาะพะลวย อ.เกาะสมุย จ.สุราษธานี",
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
            "Operator HMI 24", "Operator HMI 27", "ETH Switch 1", "ETH Switch 2", "ETH Switch 3", "ETH Switch 4", "ETH Switch 6", "ETH Switch 7","RTU SVG",
"RTU Substation","eMC-G-Controller","eMC-N-Controller INC1","eMC-N-Controller BAAN3","eMC-N-Controller BAAN4","Synnchrotact INC1","Synnchrotact OUT5","Synnchrotact OUT1","ADMS-1",
"ADMS-2","RTU Gateway 1","RTU Gateway 2","Firewall 1","Firewall 2","Firewall 3","Security HMI","GPS"
        ]
    }
};

let currentSiteKey = "ko-phaluay";
let currentDevice = null, editIndex = -1, chartInstance = null;
let currentPage = 1;
const pageSize = 7; 
let siteInitialized = false;


let isAuthenticated = false;
let currentUser = null; // Store user object

function initializeSiteIfLoggedIn() {
    // หยุดทันทีหากมีการเริ่มต้นแล้ว หรือยังไม่ได้ล็อคอิน
    if (siteInitialized || !isAuthenticated) return;
    
    const locationSelect = document.getElementById("location-select");
    if (!locationSelect) return; 

    // 1. Logic เดิมที่หา Initial Site Key (คัดลอกมาจาก DOMContentLoaded)
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

    // 2. เรียกโหลดข้อมูลหลัก
    window.switchSite(initialSiteKey);
    
    // 3. ตั้งค่า Flag เพื่อป้องกันการเรียกซ้ำ
    siteInitialized = true; 
}

function initializeSiteSelection() {
    const locationSelect = document.getElementById("location-select");
    
    if (!locationSelect) {
        console.error("Error: Element with ID 'location-select' not found.");
        return; 
    }

    // (A) เพิ่ม Event Listener (ถ้ายังไม่ได้ทำใน DOMContentLoaded)
    // ถ้าเคยทำแล้วใน DOMContentLoaded ให้ลบออกจาก DOMContentLoaded และใส่ไว้ตรงนี้แทน
    locationSelect.addEventListener("change", function() {
        switchSite(this.value);
    });
    
    try {
        let initialSiteKey = locationSelect.value;
        const siteKeys = Object.keys(sites); 
        
        // ตรวจสอบและตั้งค่า Site Key เริ่มต้น
        if (!initialSiteKey || !sites[initialSiteKey]) {
            if (siteKeys.length > 0) {
                 initialSiteKey = siteKeys[0];
                 locationSelect.value = initialSiteKey; 
            } else {
                 console.warn("No sites defined in the 'sites' object.");
                 return;
            }
        }
        
        // (B) เรียก switchSite เพื่อโหลดแผนผังและข้อมูล (รวมถึง setupRealtimeListener)
        // การเรียกนี้จะเกิดขึ้นต่อเมื่อ Firebase Auth พร้อมแล้วเท่านั้น
        window.switchSite(initialSiteKey); 
        
    } catch (error) {
         console.error("Initial Site Switch Error:", error);
    }
}

function updateUIForAuthState(user) {
    const authButton = document.getElementById('authButton');
    const userNameDisplay = document.getElementById('userNameDisplay');
    const summaryButton = document.getElementById('summaryButton');
    const exportButton = document.getElementById('exportButton');
    const importButton = document.getElementById('importButton');
    const clearButton = document.getElementById('clearButton');

    if (user) {
        isAuthenticated = true;
        currentUser = user;
        const email = user.email || user.displayName || 'ไม่ระบุอีเมล';

        authButton.textContent = 'Logout';
        authButton.classList.remove('btn-brand');
        authButton.classList.add('btn-ghost');
        
        if (userNameDisplay) {
             userNameDisplay.textContent = `${email}`;
             userNameDisplay.classList.remove('hidden');
        }

        // แสดงปุ่มฟังก์ชันทั้งหมดเมื่อล็อคอินแล้ว
        summaryButton.classList.remove('hidden');
        exportButton.classList.remove('hidden');
        importButton.classList.remove('hidden');
        clearButton.classList.remove('hidden');
        
        // อัปเดตอีเมลผู้บันทึกในฟอร์ม (หากเปิดอยู่)
        if (document.getElementById('editorEmailDisplay')) {
            document.getElementById('editorEmailDisplay').value = email;
        }
        
        // 🎯 FIX A: เรียก Logic การเริ่มต้นไซต์เมื่อล็อคอินสำเร็จแล้ว
        initializeSiteSelection(); 
        
    } else {
        isAuthenticated = false;
        currentUser = null;

        authButton.textContent = 'Login Google';
        authButton.classList.add('btn-brand');
        authButton.classList.remove('btn-ghost');
        
        if (userNameDisplay) {
            userNameDisplay.classList.add('hidden');
        }

        // ซ่อนปุ่มฟังก์ชันทั้งหมดเมื่อยังไม่ล็อคอิน
        summaryButton.classList.add('hidden');
        exportButton.classList.add('hidden');
        importButton.classList.add('hidden');
        clearButton.classList.add('hidden');

        // อัปเดตอีเมลผู้บันทึกในฟอร์ม
        if (document.getElementById('editorEmailDisplay')) {
            document.getElementById('editorEmailDisplay').value = 'กรุณาล็อคอิน';
        }

        // ปิดฟอร์มบันทึกหากเปิดอยู่เมื่อออกจากระบบ
        window.closeForm(); 
        
        // 🎯 FIX B: รีเซ็ต Flag เมื่อผู้ใช้ออกจากระบบ
        siteInitialized = false;
        
        // 🎯 FIX C: บังคับให้หน้ากลับไปที่ Topology เมื่อ Logout
        document.getElementById('summaryPage')?.classList.add('hidden');
        document.getElementById('topologyPage')?.classList.remove('hidden');
        
        // 💡 เรียก updateDeviceSummary เพื่อเคลียร์ข้อมูลที่อาจค้างอยู่
        if (typeof window.updateDeviceSummary === 'function') {
             window.updateDeviceSummary(); 
        }
    }
}

window.handleAuthAction = function() {
    if (!auth.currentUser) {
        // สร้าง Provider
        const provider = new firebase.auth.GoogleAuthProvider();
        
        // 🎯 FIX 1: ลบ ; และ .then/.catch ออก
        auth.signInWithRedirect(provider);
        // เมื่อใช้ Redirect การทำงานจะสิ้นสุดที่บรรทัดนี้ และหน้าเว็บจะโหลดใหม่
        
    } else {
        // โค้ดสำหรับ Logout
        auth.signOut().then(() => {
            Swal.fire('สำเร็จ', 'คุณออกจากระบบแล้ว', 'success');
        });
    }
};
// ฟังก์ชันบังคับตรวจสอบสิทธิ์
function requireAuth() {
    if (!isAuthenticated) {
        Swal.fire('🔒 ล็อคอินก่อน', 'กรุณาล็อคอินเพื่อเข้าสู่โหมดบันทึก/แก้ไขข้อมูล', 'warning');
        return false;
    }
    return true;
}

auth.onAuthStateChanged(function(user) {
 
    updateUIForAuthState(user); 

    if (user) {
    } else {       
    }
});

function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] || m)).replace(/\n/g, '<br>');
}

function getSiteCollection(siteKey) {
    return db.collection(`sites`).doc(siteKey).collection(`devices`);
}

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
    });
}

async function getAllDevicesDocs(siteKey) {
    return await getSiteCollection(siteKey).get();
}

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
async function loadAssetData(deviceName) {
    try {
        const assetDocRef = db.collection('asset_registration').doc(currentSiteKey);
        const doc = await assetDocRef.get();
        
        if (doc.exists) {
            const allAssets = doc.data();
            // คืนค่าข้อมูลทะเบียนเฉพาะอุปกรณ์นี้
            return allAssets[deviceName] || {}; 
        }
        return {}; // คืนค่า Object ว่างถ้าไม่พบ Document
    } catch (error) {
        console.error("Error loading asset registration data:", error);
        return {};
    }
}

// ฟังก์ชันเสริมสำหรับแปลง Timestamp หรือ Object วันที่เป็น yyyy-MM-dd
window.formatDateToInput = function(dateInput) {
    if (!dateInput) return '';

    let date;
    if (typeof firebase !== 'undefined' && dateInput instanceof firebase.firestore.Timestamp) {
        date = dateInput.toDate();
    } else if (dateInput instanceof Date) {
        date = dateInput;
    } else {
        date = new Date(dateInput);
    }
    
    if (isNaN(date.getTime())) return ''; 

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ฟังก์ชันสำหรับแปลง Timestamp เป็น YYYY-MM-DD HH:mm:ss
window.convertTimestampToDateTime = function(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

window.openForm = async function(deviceName) {
    // 💡 MODIFICATION 1: บังคับล็อคอินก่อนเปิดฟอร์ม
    if (!requireAuth()) {
        return;
    }

    currentDevice = deviceName; 
    editIndex = -1;
    
    document.getElementById('formTitle').textContent = `บันทึกข้อมูล: ${deviceName}`;
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('formModal').style.display = 'block';
    document.getElementById('editHint').classList.add('hidden');
    
    clearForm(); 

    // 💡 MODIFICATION 2: แสดงอีเมลผู้บันทึกจาก Auth
    if (currentUser) {
        document.getElementById('editorEmailDisplay').value = currentUser.email || currentUser.displayName || 'ไม่ระบุ';
    } else {
         document.getElementById('editorEmailDisplay').value = 'กรุณาล็อคอิน';
    }

    const assetData = await loadAssetData(deviceName);
    
    document.getElementById('assetId').value = assetData.assetId || ''; 
    document.getElementById('manufacturer').value = assetData.manufacturer || ''; 
    document.getElementById('model').value = assetData.model || ''; 
    
    // **เรียกใช้ window.formatDateToInput**
    document.getElementById('warrantyStartDate').value = window.formatDateToInput(assetData.warrantyStartDate);
    document.getElementById('installDate').value = window.formatDateToInput(assetData.installDate);
    document.getElementById('warrantyYears').value = assetData.warrantyYears !== undefined ? assetData.warrantyYears : 0;
        
    await loadHistory();
}

window.closeForm = function() {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('formModal').style.display = 'none';
}

function clearForm() {
    document.getElementById('status').value = 'ok';
    document.getElementById('brokenDate').value = ''; 
    document.getElementById('fixedDate').value = ''; 
    document.getElementById('description').value = '';

    // Asset Fields
    document.getElementById('assetId').value = ''; 
    document.getElementById('manufacturer').value = '';
    document.getElementById('model').value = '';
	document.getElementById('installDate').value = '';
    document.getElementById('warrantyStartDate').value = '';
    document.getElementById('warrantyYears').value = '0'; 
}

function isValidDate(str) {
    if (!str) return false;
    const d = new Date(str);
    return d instanceof Date && !isNaN(d); 
}


window.saveData = async function() {
    // 💡 MODIFICATION 3: บังคับล็อคอินและดึงข้อมูลผู้แก้ไข
    if (!requireAuth()) {
        return false;
    }
    const editorEmail = currentUser.email || currentUser.displayName || 'ไม่ระบุ';
    const editorUID = currentUser.uid;
    // 💡 END MODIFICATION 3

    if (!currentDevice) {
        alert("กรุณาเลือกอุปกรณ์");
        return false;
    }
    // --- 1. History Data ---
    const statusVal = document.getElementById('status').value;
    const brokenDate = document.getElementById('brokenDate').value;
    const fixedDate = document.getElementById('fixedDate').value;
    const description = document.getElementById('description').value.trim();

    // --- 2. Asset Registration Data ---
    const assetId = document.getElementById('assetId')?.value || '';
    const manufacturer = document.getElementById('manufacturer')?.value || '';
    const model = document.getElementById('model')?.value || '';
    const warrantyStartDate = document.getElementById('warrantyStartDate')?.value || '';

    const installDate = document.getElementById('installDate')?.value || '';
    let warrantyYears = parseInt(document.getElementById('warrantyYears')?.value || 0) || 0;
    if (isNaN(warrantyYears)) warrantyYears = 0; 


    // --- 3. Validation ---
    const now = new Date();
    now.setHours(0, 0, 0, 0); 
    
    if (brokenDate && isValidDate(brokenDate)) {
        const brokenDateTime = new Date(brokenDate);
        brokenDateTime.setHours(0, 0, 0, 0); 
        if (brokenDateTime > now) {
            alert("วันที่ชำรุดไม่สามารถอยู่หลังวันที่ปัจจุบันได้");
            return false;
        }
    }
    
    if (fixedDate && isValidDate(fixedDate)) {
        const fixedDateTime = new Date(fixedDate);
        fixedDateTime.setHours(0, 0, 0, 0); 
        if (fixedDateTime > now) {
            alert("วันที่ซ่อมแซมไม่สามารถอยู่หลังวันที่ปัจจุบันได้");
            return false;
        }
    }
    
    if (statusVal === 'down') {
        if (!isValidDate(brokenDate)) {
            alert("กรุณาเลือกวันที่ชำรุด เมื่อสถานะเป็น 'ชำรุด'");
            return false;
        }
        if (fixedDate) {
            alert("ห้ามใส่วันที่ซ่อมแซม เมื่อสถานะเป็น 'ชำรุด'");
            return false;
        }
    }
    
    if (statusVal === 'ok') {
        if (!isValidDate(brokenDate)) {
            alert("กรุณาเลือกวันที่ชำรุด");
            return false;
        }
        if (!isValidDate(fixedDate)) {
            alert("กรุณาเลือกวันที่ซ่อมแซม");
            return false;
        }
        if (new Date(brokenDate) > new Date(fixedDate)) {
            alert("วันที่ซ่อมแซมต้องหลังวันที่ชำรุด");
            return false;
        }
    } 
    if (fixedDate && statusVal !== 'ok') {
        alert("ห้ามใส่วันที่ซ่อมแซม ถ้าไม่ได้เลือกสถานะ 'ใช้งานได้'");
        return false;
    }
    if (brokenDate && !(statusVal === 'ok' || statusVal === 'down')) {
         alert("ต้องเลือกสถานะ 'ชำรุด' หรือ 'ใช้งานได้' เมื่อใส่วันที่ชำรุด");
         return false;
    }

    let records = await getDeviceRecords(currentSiteKey, currentDevice);

    if (editIndex < 0 && statusVal === 'down') {
        if (records.length > 0) {
            const latestRecord = records.reduce((a, b) => b.ts > a.ts ? b : a, records[0]);

            if (latestRecord && latestRecord.status === 'down') {
                alert(`อุปกรณ์ ${currentDevice} ยังอยู่ในสถานะ 'ชำรุด' จากรายการล่าสุด หากต้องการบันทึกการชำรุดครั้งใหม่ กรุณาบันทึกรายการสถานะ 'ใช้งานได้' ก่อน`);
                return false;
            }
        }
    }

    // --- 4. Save Asset Data ---
    const newAssetData = {
        assetId: assetId,
        manufacturer: manufacturer,
        model: model,
        installDate: installDate,
        warrantyStartDate: warrantyStartDate,
        warrantyYears: warrantyYears, 
    };

    try {
        const assetDocRef = db.collection('asset_registration').doc(currentSiteKey);
        const doc = await assetDocRef.get();
        const allAssets = doc.exists ? doc.data() : {};
        
        allAssets[currentDevice] = newAssetData;
        await assetDocRef.set(allAssets); 
        console.log(`Asset registration data saved for ${currentDevice}`);
    } catch (error) {
        console.error("Error saving asset registration data:", error);
        alert('ไม่สามารถบันทึกข้อมูลทะเบียนทรัพย์สินได้: ' + error.message);
        return false;
    }


    // --- 5. Save History Record ---
   const baseRec = {
        // 💡 MODIFICATION 4: บันทึกข้อมูลผู้แก้ไขจาก Auth
        user: editorEmail, // ใช้ Email/Display Name
        editorUID: editorUID, // ใช้ UID (Unique ID)
        // 💡 END MODIFICATION 4
        status: statusVal,
        brokenDate,
        fixedDate,
        description: document.getElementById('description').value,
        ts: Date.now(),
        counted: (statusVal === 'down')
    };

    if (editIndex >= 0) {
        const originalRecord = records[editIndex];

        records[editIndex] = {
            ...originalRecord,
            ...baseRec,
            ts: originalRecord.ts
        };
        if (statusVal === 'ok') {
            records[editIndex].counted = originalRecord.counted || false; 
        } else {
            records[editIndex].counted = true;
        }

        editIndex = -1;
        document.getElementById('editHint').classList.add('hidden');
    } else {
        records.push(baseRec);
    }
    
    await saveDeviceRecords(currentSiteKey, currentDevice, records);
    
    window.closeForm(); 
    clearForm();
    await loadHistory();
    window.updateDeviceSummary();
    window.updateDeviceStatusOverlays(currentSiteKey);
    alert("บันทึกเรียบร้อย");
    return true;
};


// =================================================================================
// **ฟังก์ชันสำหรับ Export (ส่งออก) ข้อมูล**
// =================================================================================

async function getAssetDataForExport(siteKey) {
    try {
        const assetDocRef = db.collection('asset_registration').doc(siteKey);
        const doc = await assetDocRef.get();
        return doc.exists ? doc.data() : {}; 
    } catch (error) {
        console.error("Error loading all asset registration data for export:", error);
        return {};
    }
}

window.exportAllDataExcel = async function() {
    // 💡 FIX 1: ประกาศตัวแปร dataMap เพื่อเก็บข้อมูลที่ดึงมา และแก้ ReferenceError
    const dataMap = {}; 

    // 💡 MODIFICATION 5: บังคับล็อคอินก่อนส่งออก
    if (!requireAuth()) {
        return;
    }
    if (typeof XLSX === 'undefined') {
        Swal.fire('ข้อผิดพลาด', 'ไม่พบไลบรารี SheetJS (XLSX) กรุณาตรวจสอบการนำเข้าไฟล์ script', 'error');
        return;
    }
    if (!currentSiteKey || !sites[currentSiteKey]) {
        Swal.fire('ข้อผิดพลาด', 'กรุณาเลือกไซต์ที่ต้องการส่งออกข้อมูล', 'error');
        return;
    }
    
    const siteName = sites[currentSiteKey].name;
    const devices = sites[currentSiteKey].devices;
    
    Swal.fire({
        title: 'กำลังส่งออกข้อมูล',
        html: `กำลังรวบรวมข้อมูล ${siteName} (${devices.length} อุปกรณ์)...`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    const workbook = XLSX.utils.book_new();
    let allHistoryRecords = [];
    let allAssetRecords = [];

    // ดึงข้อมูล Asset Registration สำหรับทุกอุปกรณ์ในไซต์
    const assetData = await getAssetDataForExport(currentSiteKey);

    // 1. Fetch History Data (Device by Device)
    for (const deviceName of devices) {
        try {
            // 💡 FIX 2: ดึงประวัติ (History Records) จริง ๆ จาก Firebase
            // นี่คือส่วนที่ขาดหายไปและทำให้ records ว่าง
            const records = await getDeviceRecords(currentSiteKey, deviceName); 
            
            // 💡 FIX 3: เก็บ records ที่ดึงมาไว้ใน dataMap เพื่อให้โค้ดส่วนถัดไปทำงานได้
            dataMap[deviceName] = { records: records };

            // ดึง Asset Data ของอุปกรณ์ปัจจุบัน (ใช้ loadAssetData หรือ assetData[deviceName])
            const assetDeviceData = await loadAssetData(deviceName); // ใช้ loadAssetData เพื่อความแน่นอน
            
            // 💡 ใช้ records ที่ถูกดึงมาใหม่เพื่อ format
            const formattedHistory = records.map(rec => ({ 
                'Device': deviceName,
                'User': rec.user || 'ไม่ระบุ',
                'Editor UID': rec.editorUID || 'ไม่ระบุ',
                'Status': rec.status === 'ok' ? 'ใช้งานได้' : 'ชำรุด',
                'Broken Date': rec.brokenDate || '',
                'Fixed Date': rec.fixedDate || '',
                'Description': rec.description || '',
                'Timestamp (บันทึก)': window.convertTimestampToDateTime(rec.ts),
                'TS (Unix)': rec.ts
            }));

            allHistoryRecords = allHistoryRecords.concat(formattedHistory);
            
            // 2. Prepare Asset Data (for the Asset Registration Sheet)
            const deviceAsset = assetDeviceData || {};
            allAssetRecords.push({
                'Device': deviceName,
                'Asset ID': deviceAsset.assetId || '',
                'Manufacturer': deviceAsset.manufacturer || '',
                'Model': deviceAsset.model || '',
                'Install Date': deviceAsset.installDate || '', 
                'Warranty Start Date': deviceAsset.warrantyStartDate || '',
                'Warranty Years': deviceAsset.warrantyYears || 0
            });
            
        } catch (e) {
            console.error(`Error fetching data for device ${deviceName}:`, e);
            // แสดงข้อผิดพลาดเล็กน้อยโดยไม่หยุดการ Export ทั้งหมด
            Swal.update({
                title: 'ข้อผิดพลาดบางส่วน',
                html: `เกิดข้อผิดพลาดในการดึงข้อมูล ${deviceName} แต่จะดำเนินการต่อ`
            });
        }
    }

    // 3. Create Worksheets
    if (allHistoryRecords.length > 0) {
        const wsHistory = XLSX.utils.json_to_sheet(allHistoryRecords);
        XLSX.utils.book_append_sheet(workbook, wsHistory, 'History_All');
    } 
    
    if (allAssetRecords.length > 0) {
        const wsAsset = XLSX.utils.json_to_sheet(allAssetRecords);
        XLSX.utils.book_append_sheet(workbook, wsAsset, 'Asset_Registration');
    }

    // ตรวจสอบว่ามีข้อมูลใน workbook หรือไม่ก่อน Download
    if (workbook.SheetNames.length === 0) {
        Swal.fire('ข้อผิดพลาด', 'ไม่พบข้อมูลสำหรับส่งออก', 'warning');
        return;
    }

    // 4. Download File
    const filename = `${currentSiteKey}_Data_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename);
    
    Swal.fire('ส่งออกข้อมูลสำเร็จ', `ไฟล์ ${filename} ถูกดาวน์โหลดแล้ว`, 'success');
};

window.importData = function() {
	 // 💡 MODIFICATION 7: บังคับล็อคอินก่อนนำเข้า
    if (!requireAuth()) {
        event.target.value = ''; // เคลียร์ไฟล์ที่เลือกไว้
        return;
    }

    if (typeof XLSX === 'undefined') {
        Swal.fire('ข้อผิดพลาด', 'ไม่พบไลบรารี SheetJS (XLSX) กรุณาตรวจสอบการนำเข้าไฟล์ script', 'error');
        return;
    }
    if (!currentSiteKey) {
        Swal.fire('ข้อผิดพลาด', 'กรุณาเลือกไซต์ที่ต้องการนำเข้าข้อมูล', 'error');
        return;
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx';

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        Swal.fire({
            title: 'กำลังนำเข้าข้อมูล...',
            html: `กำลังอ่านไฟล์: ${file.name}<br>โปรดรอสักครู่`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const reader = new FileReader();
        
        reader.onload = async (event) => {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array', dateNF: "yyyy-mm-dd" }); 

                let assetImportCount = 0;
                let historyImportCount = 0;

                // --- A. Process Asset Registration Sheet ---
                const assetSheetName = 'Asset_Registration';
                if (workbook.SheetNames.includes(assetSheetName)) {
                    const worksheet = workbook.Sheets[assetSheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    
                    const header = json[0];
                    const rows = json.slice(1);
                    
                    const assetDataToSave = {};

                    const deviceCol = header.indexOf('Device');
                    const assetIdCol = header.indexOf('Asset ID');
                    const manufacturerCol = header.indexOf('Manufacturer');
                    const modelCol = header.indexOf('Model');
                    const installDateCol = header.indexOf('Install Date');
                    const warrantyStartCol = header.indexOf('Warranty Start Date');
                    const warrantyYearsCol = header.indexOf('Warranty Years');
                    
                    if (deviceCol === -1) {
                         throw new Error(`Sheet ${assetSheetName}: ไม่พบคอลัมน์ 'Device'`);
                    }

                    rows.forEach(row => {
                        const deviceName = row[deviceCol];
                        if (deviceName) {
                            assetDataToSave[deviceName] = {
                                assetId: row[assetIdCol] || '',
                                manufacturer: row[manufacturerCol] || '',
                                model: row[modelCol] || '',
                                // ใช้ window.formatDateToInput เพื่อจัดการ Date String จาก Excel
                                installDate: window.formatDateToInput(row[installDateCol]) || '', 
                                warrantyStartDate: window.formatDateToInput(row[warrantyStartCol]) || '',
                                warrantyYears: parseInt(row[warrantyYearsCol]) || 0,
                            };
                            assetImportCount++;
                        }
                    });

                    const assetDocRef = db.collection('asset_registration').doc(currentSiteKey);
                    await assetDocRef.set(assetDataToSave, { merge: true }); 
                }

                // --- B. Process History Records Sheet ---
                const historySheetName = 'History_All';
                if (workbook.SheetNames.includes(historySheetName)) {
                    const worksheet = workbook.Sheets[historySheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    
                    const header = json[0];
                    const rows = json.slice(1);
                    
                    const historyByDevice = {};
                    
                    const deviceCol = header.indexOf('Device');
                    const userCol = header.indexOf('User');
                    const statusCol = header.indexOf('Status');
                    const brokenDateCol = header.indexOf('Broken Date');
                    const fixedDateCol = header.indexOf('Fixed Date');
                    const descriptionCol = header.indexOf('Description');
                    const tsCol = header.indexOf('TS (Unix)'); 

                    if (deviceCol === -1) {
                         throw new Error(`Sheet ${historySheetName}: ไม่พบคอลัมน์ 'Device'`);
                    }

                    rows.forEach(row => {
                        const deviceName = row[deviceCol];
                        if (!deviceName) return;
                        
                        const statusText = String(row[statusCol] || 'ใช้งานได้').toLowerCase();
                        const statusValue = (statusText.includes('ชำรุด') || statusText.includes('down')) ? 'down' : 'ok';
                        
                        // ใช้ window.formatDateToInput เพื่อจัดการ Date String จาก Excel
                        const brokenDateStr = row[brokenDateCol] ? window.formatDateToInput(row[brokenDateCol]) : '';
                        const fixedDateStr = row[fixedDateCol] ? window.formatDateToInput(row[fixedDateCol]) : '';

                        const record = {
                            user: row[userCol] || 'ไม่ระบุ',
                            status: statusValue,
                            brokenDate: brokenDateStr, 
                            fixedDate: fixedDateStr,
                            description: row[descriptionCol] || '',
                            ts: row[tsCol] || Date.now(),
                            counted: (statusValue === 'down')
                        };

                        if (!historyByDevice[deviceName]) {
                            historyByDevice[deviceName] = [];
                        }
                        historyByDevice[deviceName].push(record);
                        historyImportCount++;
                    });
                    
                    for (const deviceName in historyByDevice) {
                        historyByDevice[deviceName].sort((a, b) => a.ts - b.ts);
                        await saveDeviceRecords(currentSiteKey, deviceName, historyByDevice[deviceName]);
                    }
                }

                Swal.fire('นำเข้าสำเร็จ', 
                    `นำเข้าข้อมูลทะเบียนทรัพย์สิน ${assetImportCount} รายการ<br>` + 
                    `นำเข้าประวัติการชำรุด ${historyImportCount} รายการ`, 
                    'success'
                );
                
                window.updateDeviceSummary();
                window.updateDeviceStatusOverlays(currentSiteKey);

            } catch (error) {
                console.error("Import Error:", error);
                Swal.fire('ข้อผิดพลาดในการนำเข้า', 
                    `เกิดข้อผิดพลาดขณะประมวลผลไฟล์: ${error.message}`, 
                    'error'
                );
            }
        };
        reader.onerror = (error) => {
            console.error("File Read Error:", error);
            Swal.fire('ข้อผิดพลาด', 'ไม่สามารถอ่านไฟล์ได้', 'error');
        };
        reader.readAsArrayBuffer(file);
    };

    fileInput.click();
};
window.clearCurrentDevice = async function() {
	// 💡 MODIFICATION 8: บังคับล็อคอินก่อนล้างข้อมูล
    if (!requireAuth()) {
        return;
    }

    if (!currentDevice) return;
    
    const confirmed = await Swal.fire({
        title: 'ยืนยันการล้างข้อมูล',
        text: `คุณแน่ใจหรือไม่ที่จะล้างข้อมูลทะเบียนทรัพย์สินและประวัติทั้งหมดของ ${currentDevice} ?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ใช่, ล้างเลย!',
        cancelButtonText: 'ยกเลิก'
    });

    if (confirmed.isConfirmed) {
        try {
            // ล้าง Asset Registration
            const assetDocRef = db.collection('asset_registration').doc(currentSiteKey);
            const doc = await assetDocRef.get();
            if (doc.exists) {
                const allAssets = doc.data();
                delete allAssets[currentDevice];
                await assetDocRef.set(allAssets); 
            }
            
            // ล้าง History (สมมติว่าคุณมีฟังก์ชันล้าง History)
            await saveDeviceRecords(currentSiteKey, currentDevice, []); 

            Swal.fire('ล้างข้อมูลสำเร็จ', `ข้อมูลของอุปกรณ์ ${currentDevice} ถูกล้างเรียบร้อยแล้ว`, 'success');
            clearForm();
            window.closeForm();
            window.updateDeviceSummary();
            window.updateDeviceStatusOverlays(currentSiteKey);

        } catch (error) {
             Swal.fire('ข้อผิดพลาด', 'ไม่สามารถล้างข้อมูลได้: ' + error.message, 'error');
        }
    }
};


async function loadHistory() {
    const container = document.getElementById('historySection');
    container.innerHTML = '';
    if (!currentDevice) return;
    
    // ต้องแน่ใจว่าได้เรียกใช้ getDeviceRecords ที่มีข้อมูล user และ editorUID
    const records = await getDeviceRecords(currentSiteKey, currentDevice);
    records.sort((a, b) => b.ts - a.ts); // เรียงจากใหม่ไปเก่า

    if (records.length === 0) {
        container.innerHTML = '<p class="text-center py-4 text-gray-400">ไม่พบประวัติการบันทึกสำหรับอุปกรณ์นี้</p>';
        return;
    }
    
    // Flag เพื่อควบคุมให้แสดง (ชำรุด) เฉพาะรายการที่ใหม่ที่สุดที่ยังไม่ได้ซ่อมเท่านั้น
    let isCurrentBrokenFound = false; 

    records.forEach((r, index) => {
        // --- 1. คำนวณระยะเวลาชำรุด (Duration) ---
        let duration = '-';
        
        if (r.brokenDate) {
            
            // ตรวจสอบว่ามีวันที่ซ่อมแซมหรือไม่ (r.fixedDate จะเป็น string ว่าง '' ถ้าไม่ได้กรอก)
            if (r.fixedDate) {
                // กรณี: ซ่อมแซมแล้ว
                const days = calculateDaysDifference(r.brokenDate, r.fixedDate);
                duration = formatDuration(days);
                
                // ตั้ง Flag ให้เป็น true เพื่อให้รายการชำรุดอื่นๆ ที่เป็นรายการ 'down' เก่า ไม่แสดงซ้ำ (ชำรุด)
                isCurrentBrokenFound = true; 

            } else if (r.status === 'down' && !isCurrentBrokenFound) {
                // กรณี: ยังชำรุด (status: down, fixedDate: '') และเป็นรายการที่ใหม่ที่สุดที่ยังชำรุด
                const days = calculateDaysDifference(r.brokenDate, null); // null = วันที่ปัจจุบัน
                
                // 💡 แสดง (ชำรุด) ทันที
                duration = formatDuration(days) + ' <span class="text-sm text-red-400 font-semibold">(ชำรุด)</span>';
                
                isCurrentBrokenFound = true;

            } else if (r.status === 'down') {
                // รายการชำรุดเก่าๆ ที่ถูกปิดด้วยรายการสถานะ 'ok' อื่นๆ แล้ว
                const days = calculateDaysDifference(r.brokenDate, null);
                duration = formatDuration(days);
            }
        }
        
        const statusClass = r.status === 'ok' ? 'tag-ok' : 'tag-bad';
        const statusText = r.status === 'ok' ? '✅ ใช้งานได้' : '❎ ชำรุด';
        
        // 💥 NEW: สร้าง HTML สำหรับแสดง User และ Editor UID
        const editorInfo = r.editorUID ? `(<span title="${escapeHtml(r.editorUID)}">${escapeHtml(r.editorUID.substring(0, 4))}...</span>)` : ''; // แสดง UID 4 ตัวแรก
        const userDisplayHtml = `${escapeHtml(r.user || 'ไม่ระบุ')} ${editorInfo}`;
        
        // --- 2. การสร้าง HTML ---
        const div = document.createElement('div');
        div.className = 'p-4 mb-3 border border-gray-700 bg-gray-800 rounded-lg shadow-md'; 
        
        div.innerHTML = `
            <div class="flex justify-between items-start border-b border-gray-700 pb-2 mb-2">
                <div class="text-lg font-bold text-white">
                    <span class="tag ${statusClass}">${statusText}</span>
                </div>
                <div class="text-sm text-gray-400">
                    บันทึกโดย: <span class="font-semibold text-white">${userDisplayHtml}</span>
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
                <button class="btn btn-ghost text-yellow-500 hover:bg-gray-700" onclick="editRecord('${r.ts}')">✏️ แก้ไข</button>
                <button class="btn btn-danger text-white-500 hover:bg-gray-700" onclick="deleteRecord('${r.ts}')">🗑️ ลบ</button>
            </div>
        `;
        container.appendChild(div);
    });
}
window.deleteRecord = async function(ts) {
    if (!currentDevice) return;
    if (!confirm("คุณต้องการลบรายการนี้จริงหรือไม่?")) return;
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
    if (!currentDevice) return;
    let records = await getDeviceRecords(currentSiteKey, currentDevice);
    const idx = records.findIndex(r => String(r.ts) === String(ts));
    if (idx < 0) return;
    const r = records[idx];
    document.getElementById('status').value = r.status || 'ok';
    document.getElementById('brokenDate').value = r.brokenDate || '';
    document.getElementById('fixedDate').value = r.fixedDate || '';
    document.getElementById('description').value = r.description || '';
    editIndex = idx;
    document.getElementById('editHint').classList.remove('hidden');
};

window.updateDeviceSummary = async function() {
    const siteData = sites[currentSiteKey];
    if (!siteData) return;

    // Filter/Sort Parameters
   const search = document.getElementById('searchInput')?.value?.toLowerCase() || '';
    const sortOrder = document.getElementById('sortOrder')?.value || 'desc';
    const filterStatus = document.getElementById('filterStatus')?.value || 'all';
    const from = document.getElementById('fromDate')?.value || '';
    const to = document.getElementById('toDate')?.value || '';

    // Fetch all documents for the current site
    const docsSnap = await getSiteCollection(currentSiteKey).get({ source: 'server' }); 
        const dataMap = {}; 
        docsSnap.forEach(d => dataMap[d.id] = d.data());

    let summary = [];

    for (const dev of siteData.devices) {
        const docData = dataMap[dev]; 
        const records = docData?.records || [];
        
        // Find latest record by timestamp
        let latestRecord = null;
        if (records.length > 0) {
            // ✅ FIX: เรียงจากเก่าไปใหม่ (ts น้อยไปมาก) ให้สอดคล้องกับ saveDeviceRecords/updateAllAffectedDevicesSummary
            records.sort((a, b) => a.ts - b.ts); 
            latestRecord = records[records.length - 1]; // Get the newest record from the end
        }
        
        let downCount = docData?.downCount || 0; // ใช้ค่าที่ถูกคำนวณไว้ใน Firestore
        
        // --- Downtime Calculation for Summary Table ---
        let latestBrokenDuration = '-';
        let latestBrokenDays = 0;
        
        const currentDeviceStatus = docData?.currentStatus || 'ok';
        const isCurrentlyDown = currentDeviceStatus === 'down';

       if (isCurrentlyDown && latestRecord && latestRecord.brokenDate) {
            // คำนวณระยะเวลาชำรุดล่าสุด (ยังชำรุด)
            latestBrokenDays = calculateDaysDifference(latestRecord.brokenDate, null); // null = วันที่ปัจจุบัน
            latestBrokenDuration = formatDuration(latestBrokenDays) + ' (ชำรุด)';
        } else if (latestRecord && latestRecord.status === 'ok' && latestRecord.brokenDate && latestRecord.fixedDate) {
            // คำนวณระยะเวลาของรอบชำรุดล่าสุดที่ถูกซ่อมแล้ว
             latestBrokenDays = calculateDaysDifference(latestRecord.brokenDate, latestRecord.fixedDate);
             latestBrokenDuration = formatDuration(latestBrokenDays);
        }
        
        // 💡 การกรองวันที่ (Date Filtering)
        let latestDateStr = latestRecord ? latestRecord.brokenDate : null;


        if (latestDateStr) {
            const latestTs = new Date(latestDateStr).getTime();
            
            if (from) {
                const fromTs = new Date(from).getTime();
                if (latestTs < fromTs) continue;
            }
            if (to) {
                const toTs = new Date(to).getTime() + (1000 * 60 * 60 * 24); 
                if (latestTs >= toTs) continue;
            }
        }        
        // --- ตรรกะการกรองสถานะ (Status Filtering) ---
        // 💡 FIX: กรองตามสถานะที่เลือกอย่างถูกต้อง
        if (filterStatus === 'currently-down' && !isCurrentlyDown) {
            continue; // กรองออกถ้าเลือก "ชำรุดอยู่" แต่มันไม่ชำรุด
        }
        if (filterStatus === 'down' && downCount === 0) continue; // กรองออกถ้าเลือก "เคยชำรุด" แต่นับเป็น 0
        if (filterStatus === 'clean' && downCount > 0) continue; // กรองออกถ้าเลือก "ไม่เคยชำรุด" แต่นับ > 0
        if (search && !dev.toLowerCase().includes(search)) continue;

        summary.push({
            device: dev,
            count: downCount,
            brokenDate: latestRecord?.brokenDate || '-',
            fixedDate: latestRecord?.fixedDate || '-',
            status: isCurrentlyDown ? '❎ ชำรุด' : '✅ ใช้งานได้',
            latestDescription: latestRecord?.description || '-',
            latestBrokenDuration: latestBrokenDuration,
            latestBrokenDays: latestBrokenDays // ใช้สำหรับการเรียงลำดับสำรอง
        });
    }

    // --- Sorting Logic ---
    summary.sort((a, b) => {
        const countSort = sortOrder === 'desc' ? b.count - a.count : a.count - b.count;
        
        if (countSort !== 0) {
            return countSort;
        }
        
        // ถ้า Count เท่ากัน ให้เรียงตามระยะเวลาชำรุดล่าสุด (มากไปน้อย)
        return b.latestBrokenDays - a.latestBrokenDays; 
    });

    // --- Pagination and Rendering ---
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
                <td><span class="${s.count > 0 ? 'tag tag-bad' : 'tag tag-ok'}">${s.count}</span></td>
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
   const paginationDiv = document.getElementById('pagination');

if (paginationDiv) {
    paginationDiv.innerHTML = `
        <div class="flex justify-center items-center gap-2 mt-2">
            <button class="btn" onclick="changePage(-1)" ${currentPage===1?'disabled':''}>⬅️ ก่อนหน้า</button>
            <span>หน้า ${currentPage} / ${totalPages}</span>
            <button class="btn" onclick="changePage(1)" ${currentPage===totalPages?'disabled':''}>ถัดไป ➡️</button>
        </div>
    `;
} else {
    console.error("Error: Element 'pagination' not found.");
}

updateChart(summary); // เรียก updateChart ที่แก้ไขแล้ว
};

window.updateAllAffectedDevicesSummary = async function(deviceNames) {
    const batch = db.batch();
    let promises = [];

    // ดึงข้อมูลและสร้าง Batch Update ในขั้นตอนเดียว
    for (const device of deviceNames) {
        promises.push(new Promise(async (resolve, reject) => {
            try {
                // 1. ดึงข้อมูลทั้งหมดของอุปกรณ์นี้
                // 💡 การเรียก getDeviceRecords จะดึง records ออกมา แต่ไม่ได้เรียงลำดับ Array ที่ถูก arrayUnion
                
                // ต้องดึงเอกสารเต็มมา
                const docRef = getSiteCollection(currentSiteKey).doc(device);
                const snap = await docRef.get();
                const records = snap.exists ? (snap.data().records || []) : [];
                
                // 2. คำนวณ downCount และ currentStatus ใหม่
                // ✅ FIX: เรียงลำดับ Array ก่อนการบันทึกกลับ
                records.sort((a, b) => a.ts - b.ts);
                
                const latestRecord = records[records.length - 1];
                const downCount = records.filter(r => r.counted).length; 
                const currentStatus = latestRecord ? latestRecord.status : 'ok';
                
                // 3. เตรียมการอัปเดต: บันทึก Records ที่ถูกเรียงลำดับแล้ว
                // เปลี่ยนจาก batch.update เป็น batch.set(..., { merge: true }) 
                // เพื่อให้มั่นใจว่า Records Array ถูกแทนที่ด้วย Array ที่เรียงลำดับแล้ว
                batch.set(docRef, {
                    records, // ✅ FIX: บันทึก Records ที่ถูกเรียงลำดับแล้วกลับเข้าไป
                    downCount,
                    currentStatus
                }, { merge: true });
                resolve();
            } catch (e) {
                reject(e);
            }
        }));
    }
    try {
        await Promise.all(promises);
        await batch.commit();
        
        window.updateDeviceSummary();
        window.updateDeviceStatusOverlays(currentSiteKey);
    } catch (e) {
        console.error("Error updating summaries post-import:", e);
        // 💡 หากมี SweetAlert2 ให้ใช้ Swal.fire
        // Swal.fire('ข้อผิดพลาด', 'ไม่สามารถอัปเดตข้อมูลสรุปของอุปกรณ์หลังนำเข้าได้: ' + e.message, 'error');
    }
};

function updateChart(summary) {
    const sorted = [...summary].sort((a, b) => b.count - a.count);
    const top10 = sorted.slice(0, 10);
    const labels = top10.map(s => s.device);
    const data = top10.map(s => s.count);
    
    // ***************************************************************
    // ✅ FIX 1: ป้องกัน Error เมื่อ Chart Element เป็น null
    // ***************************************************************
    const chartElement = document.getElementById('chart'); 
    if (!chartElement) {
        console.error("Error: Chart element with ID 'chart' not found. Skipping chart rendering.");
        return; 
    }

    if (chartInstance) chartInstance.destroy();
    
    // ใช้ chartElement ที่ตรวจสอบแล้ว
    const ctx = chartElement.getContext('2d'); 
    
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
        // 💡 หากมี SweetAlert2 ให้ใช้ Swal.fire
        // Swal.fire('ข้อผิดพลาด', 'ไม่สามารถเชื่อมต่อฐานข้อมูลแบบเรียลไทม์ได้: ' + error.message, 'error');
    });
}
function calculateAssetStatus(deviceName, assetData) {
    // ... (ใช้ตรรกะคำนวณเดิมที่เคยแนะนำไป)
    if (!assetData || !assetData.installDate || !assetData.warrantyYears || !assetData.eolYears) {
        return { status: 'none', message: 'ไม่มีข้อมูลทะเบียน' };
    }

    const installDate = new Date(assetData.installDate);
    const today = new Date();
    
    const warrantyEndDate = new Date(installDate);
    warrantyEndDate.setFullYear(installDate.getFullYear() + assetData.warrantyYears);
    
    const eolDate = new Date(installDate);
    eolDate.setFullYear(installDate.getFullYear() + assetData.eolYears);

    const sixMonthsInMs = 15552000000; // 6 เดือนในหน่วยมิลลิวินาที

    // ตรวจสอบสถานะการแจ้งเตือน
    if (today > eolDate) {
        return { status: 'EOL EXPIRED', message: 'สิ้นอายุใช้งานแล้ว' };
    }
    if (eolDate.getTime() - today.getTime() < sixMonthsInMs) {
        return { status: 'EOL WARNING', message: 'ใกล้ถึงวัน EOL' };
    }
    if (today > warrantyEndDate) {
        return { status: 'WARRANTY EXPIRED', message: 'หมดประกันแล้ว' };
    }
    if (warrantyEndDate.getTime() - today.getTime() < sixMonthsInMs) {
        return { status: 'WARRANTY WARNING', message: 'ใกล้หมดประกัน' };
    }
    
    return { status: 'OK', message: 'ปกติ' };
}

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
    if (confirm("ลบข้อมูลทุกอุปกรณ์?")) {
        const docs = await getAllDevicesDocs(currentSiteKey);
        const batch = db.batch(); 

        for (let d of docs.docs) {
            const docRef = getSiteCollection(currentSiteKey).doc(d.id);
            batch.set(docRef, { records: [], downCount: 0, currentStatus: 'ok' });
        }
        await batch.commit();

        window.updateDeviceSummary(); 
        window.updateDeviceStatusOverlays(currentSiteKey); 
    }
}

// สลับหน้า
window.showSummary = function() {
    // 🌟 เปลี่ยน .getElementById('ID').classList.add เป็น .getElementById('ID')?.classList.add
    document.getElementById('topologyPage')?.classList.add('hidden');
    document.getElementById('summaryPage')?.classList.remove('hidden');
    
    // บรรทัดนี้จะถูกเรียกต่อ ไม่ว่าการสลับหน้าจะสมบูรณ์หรือไม่
    window.updateDeviceSummary(); 
};

window.showTopology = function() {
    // 🌟 เปลี่ยน .getElementById('ID').classList.add เป็น .getElementById('ID')?.classList.add
    document.getElementById('summaryPage')?.classList.add('hidden');
    document.getElementById('topologyPage')?.classList.remove('hidden');
    
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

document.addEventListener("DOMContentLoaded", function() {
    const locationSelect = document.getElementById("location-select");
    
    if (!locationSelect) {
        console.error("Error: Element with ID 'location-select' not found.");
        return; 
    }
});

window.onload = function() {
    try { imageMapResize(); } catch (e) {}
};




























