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
const pageSize = 7; // 💡 Note: This is overridden by 10 in updateDeviceSummary, kept for consistency

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
    });
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


// =========================================================================
// UI and Form Functions (Global Scope for HTML interaction)
// =========================================================================
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
        // หากมี SweetAlert2 ให้ใช้ Swal.fire
        // Swal.fire('ข้อผิดพลาด', 'ไม่สามารถโหลดข้อมูลทะเบียนอุปกรณ์ได้: ' + error.message, 'error');
        return {};
    }
}
window.openForm = async function(deviceName) {
    currentDevice = deviceName; 
    editIndex = -1;
    
    document.getElementById('formTitle').textContent = `บันทึกข้อมูล: ${deviceName}`;
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('formModal').style.display = 'block';
    document.getElementById('editHint').classList.add('hidden');
    
    // 1. ล้างฟอร์มทั้งหมดก่อน
    clearForm(); 

    // 2. 💡 NEW: โหลดข้อมูลทะเบียนทรัพย์สิน
    const assetData = await loadAssetData(deviceName);
    
    // 3. ตั้งค่าฟิลด์ Asset Registration
    // ข้อมูลเหล่านี้ถูกดึงจาก Firestore และตั้งค่าเฉพาะฟิลด์ใหม่เท่านั้น
    document.getElementById('installDate').value = assetData.installDate || '';
    document.getElementById('warrantyYears').value = assetData.warrantyYears || 2;
    document.getElementById('eolYears').value = assetData.eolYears || 10;
    
    // 4. โหลดประวัติการชำรุด (โค้ดเดิม)
    await loadHistory();
}

window.closeForm = function() {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('formModal').style.display = 'none';
}

function clearForm() {
    document.getElementById('userName').value = '';
    document.getElementById('status').value = 'ok';
    document.getElementById('brokenDate').value = '';
    document.getElementById('fixedDate').value = '';
    document.getElementById('description').value = '';
	document.getElementById('installDate').value = '';
    // ตั้งค่า default กลับไปเป็นค่ามาตรฐาน เช่น 2 และ 10 ปี
    document.getElementById('warrantyYears').value = 2; 
    document.getElementById('eolYears').value = 10;
}

function isValidDate(str) {
    if (!str) return false;
    const d = new Date(str);
    return d instanceof Date && !isNaN(d); 
}

window.saveData = async function() {
    if (!currentDevice) {
        alert("กรุณาเลือกอุปกรณ์");
        return false;
    }

    const statusVal = document.getElementById('status').value;
    const brokenDate = document.getElementById('brokenDate').value;
    const fixedDate = document.getElementById('fixedDate').value;

	const installDate = document.getElementById('installDate').value;
    const warrantyYears = parseInt(document.getElementById('warrantyYears').value) || 0;
    const eolYears = parseInt(document.getElementById('eolYears').value) || 0;
    // VALIDATION: ห้ามวันที่ชำรุด/ซ่อมแซมอยู่หลังวันที่ปัจจุบัน
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

    if (brokenDate && !(statusVal === 'down' || statusVal === 'ok')) {
        alert("ห้ามใส่วันที่ชำรุด ถ้าไม่ได้เลือกสถานะ 'ชำรุด' หรือ 'ใช้งานได้'");
        return false;
    }
    
    let records = await getDeviceRecords(currentSiteKey, currentDevice);

    // VALIDATION: บล็อกการบันทึก 'ชำรุด' ซ้ำซ้อน
    if (editIndex < 0 && statusVal === 'down') {
        if (records.length > 0) {
            const latestRecord = records.reduce((a, b) => b.ts > a.ts ? b : a, records[0]);

            if (latestRecord && latestRecord.status === 'down') {
                alert(`อุปกรณ์ ${currentDevice} ยังอยู่ในสถานะ 'ชำรุด' จากรายการล่าสุด หากต้องการบันทึกการชำรุดครั้งใหม่ กรุณาบันทึกรายการสถานะ 'ใช้งานได้' ก่อน`);
                return false;
            }
        }
    }
    if (installDate) {
        const newAssetData = {
            installDate: installDate,
            warrantyYears: warrantyYears,
            eolYears: eolYears
        };
        
        // บันทึกไปยัง Collection ใหม่ชื่อ 'asset_registration'
        const assetDocRef = db.collection('asset_registration').doc(currentSiteKey);
        
        // ใช้ set() กับ Merge เพื่ออัปเดตเฉพาะอุปกรณ์นี้
        await assetDocRef.set({
            [currentDeviceKey]: newAssetData 
        }, { merge: true });

        console.log(`Asset registration data saved for ${currentDeviceKey}`);
    }

    const baseRec = {
        user: document.getElementById('userName').value || "ไม่ระบุ",
        status: statusVal,
        brokenDate,
        fixedDate,
        description: document.getElementById('description').value,
        ts: Date.now(),
        counted: (statusVal === 'down') // ตั้งค่าเริ่มต้น
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
    // 💡 หากมี SweetAlert2 ให้ใช้ Swal.fire("บันทึกเรียบร้อย", "", "success");
    alert("บันทึกเรียบร้อย");
    return true;
};

window.clearCurrentDevice = async function() {
    if (!currentDevice) return;
    if (confirm(`ลบข้อมูลทั้งหมดของ ${currentDevice}?`)) {
        await getSiteCollection(currentSiteKey).doc(currentDevice).set({ 
            records: [], 
            downCount: 0,
            currentStatus: 'ok' 
        });
        await loadHistory();
        window.updateDeviceSummary(); 
        window.updateDeviceStatusOverlays(currentSiteKey); 
        // 💡 หากมี SweetAlert2 ให้ใช้ Swal.fire("ลบเรียบร้อย", "", "success");
    } 
} 

// File: main.js - แทนที่ฟังก์ชัน loadHistory ทั้งหมด
async function loadHistory() {
    const container = document.getElementById('historySection');
    container.innerHTML = '';
    if (!currentDevice) return;
    
    const records = await getDeviceRecords(currentSiteKey, currentDevice);
    records.sort((a, b) => b.ts - a.ts); // เรียงจากใหม่ไปเก่า

    if (records.length === 0) {
        container.innerHTML = '<p class="text-center py-4 text-gray-400">ไม่พบประวัติการบันทึกสำหรับอุปกรณ์นี้</p>';
        return;
    }
    
    // Flag เพื่อควบคุมให้แสดง (ชำรุด) เฉพาะรายการที่ใหม่ที่สุดเท่านั้น
    let isCurrentBrokenFound = false; 

    records.forEach((r, index) => {
        // --- 1. คำนวณระยะเวลาชำรุด (Duration) ---
        let duration = '-';
        
        if (r.brokenDate) {
            
            // ตรวจสอบว่ามีวันที่ซ่อมแซมหรือไม่
            if (r.fixedDate) {
                // กรณี: ซ่อมแซมแล้ว
                const days = calculateDaysDifference(r.brokenDate, r.fixedDate);
                duration = formatDuration(days);
                
                // ถ้ารายการนี้ถูกซ่อมแล้ว (fixedDate มีค่า) รายการที่เก่ากว่าจะไม่ควรได้รับ Tag (ชำรุด)
                isCurrentBrokenFound = true; // 💡 ตั้งเป็น true เพื่อ 'ปิด' ไม่ให้รายการเก่าๆ แสดง (ชำรุด)

            } 
            // ✅ FIX 2: ใช้เงื่อนไขที่รัดกุมที่สุด: fixedDate ต้องเป็น null เท่านั้น
            else if (r.fixedDate === null && !isCurrentBrokenFound) { 
                // กรณี: ยังชำรุด (fixedDate เป็น null)
                const days = calculateDaysDifference(r.brokenDate, null);
                
                // 💡 แสดง (ชำรุด) ทันที
                duration = formatDuration(days) + ' <span class="text-sm text-red-400 font-semibold">(ชำรุด)</span>';
                
                // ตั้ง Flag ให้เป็น true เพื่อให้รายการชำรุดอื่นๆ ที่เป็นรายการ 'down' เก่า ไม่แสดงซ้ำ
                isCurrentBrokenFound = true;

            } else {
                 // รายการที่ไม่มี fixedDate แต่ไม่ใช่รายการล่าสุด (เช่น รายการ down ที่ถูกรายการ fixedDate ปิดไปแล้ว)
                 const days = calculateDaysDifference(r.brokenDate, null);
                 duration = formatDuration(days);
            }
        }
        
        const statusClass = r.status === 'ok' ? 'tag-ok' : 'tag-bad';
        const statusText = r.status === 'ok' ? '✅ ใช้งานได้' : '❎ ชำรุด';
        
        // --- 2. การสร้าง HTML (เหมือนเดิม) ---
        const div = document.createElement('div');
        div.className = 'p-4 mb-3 border border-gray-700 bg-gray-800 rounded-lg shadow-md'; 
        
        div.innerHTML = `
            <div class="flex justify-between items-start border-b border-gray-700 pb-2 mb-2">
                <div class="text-lg font-bold text-white">
                    <span class="tag ${statusClass}">${statusText}</span>
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
    document.getElementById('userName').value = r.user || '';
    document.getElementById('status').value = r.status || 'ok';
    document.getElementById('brokenDate').value = r.brokenDate || '';
    document.getElementById('fixedDate').value = r.fixedDate || '';
    document.getElementById('description').value = r.description || '';
    editIndex = idx;
    document.getElementById('editHint').classList.remove('hidden');
};

// =========================================================================
// Summary Table and Filtering Logic
// =========================================================================

window.updateDeviceSummary = async function() {
    const siteData = sites[currentSiteKey];
    if (!siteData) return;

    // Filter/Sort Parameters
    const search = document.getElementById('searchInput').value.toLowerCase();
    const sortOrder = document.getElementById('sortOrder').value;
    const filterStatus = document.getElementById('filterStatus').value;
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;

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
    document.getElementById('pagination').innerHTML = `
        <div class="flex justify-center items-center gap-2 mt-2">
            <button class="btn" onclick="changePage(-1)" ${currentPage===1?'disabled':''}>⬅️ ก่อนหน้า</button>
            <span>หน้า ${currentPage} / ${totalPages}</span>
            <button class="btn" onclick="changePage(1)" ${currentPage===totalPages?'disabled':''}>ถัดไป ➡️</button>
        </div>
    `;

    updateChart(summary);
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
window.importData = function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            // Assume XLSX library is loaded
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });
            const wsname = wb.SheetNames[0];
            
            const ws = wb.Sheets[wsname];
            const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });
            if (rawData.length < 2) {
                Swal.fire('ผิดพลาด', 'ไม่พบข้อมูลในไฟล์ Excel', 'error');
                return;
            }

            const headers = rawData[0];
            const recordsToSave = {};
            // 💡 NEW: Object สำหรับเก็บข้อมูลทะเบียนทรัพย์สิน
            const assetsToSave = {}; 

            const headerMap = {
                'ชื่ออุปกรณ์': -1, 
                'วันที่ชำรุด': -1, 
                'วันที่ซ่อมแซม': -1, 
                'สถานะ': -1, 
                'คำอธิบาย': -1, 
                'ผู้บันทึก': -1,
                // 💡 NEW Asset Registration Headers
                'วันที่ติดตั้ง': -1,
                'ระยะเวลารับประกัน (ปี)': -1,
                'อายุการใช้งานที่คาดการณ์ (ปี)': -1
            };
            
            headers.forEach((h, i) => {
                const trimmedHeader = h.trim();
                if (headerMap.hasOwnProperty(trimmedHeader)) {
                    headerMap[trimmedHeader] = i;
                }
            });

            const requiredHistoryHeaders = ['ชื่ออุปกรณ์', 'วันที่ชำรุด', 'สถานะ'];
            if (requiredHistoryHeaders.some(h => headerMap[h] === -1)) {
                // เปลี่ยนข้อความแจ้งเตือนให้เฉพาะเจาะจงขึ้น
                Swal.fire('ผิดพลาด', 'ไฟล์นำเข้าต้องมีคอลัมน์หลักสำหรับประวัติชำรุด: ชื่ออุปกรณ์, วันที่ชำรุด, สถานะ', 'error');
                return;
            }

            for (let i = 1; i < rawData.length; i++) {
                const row = rawData[i];
                
                const deviceName = row[headerMap['ชื่ออุปกรณ์']];
                if (!deviceName) continue;

                // ====================================================================
                // 💡 NEW: 1. ประมวลผลข้อมูลทะเบียนทรัพย์สิน (Asset Registration)
                // ====================================================================
                const importedInstallDate = (row[headerMap['วันที่ติดตั้ง']] || '').toString().slice(0, 10);
                // ใช้ Number.parseInt เพื่อจัดการค่าที่อาจเป็นตัวเลข
                const importedWarranty = Number.parseInt(row[headerMap['ระยะเวลารับประกัน (ปี)']] || 0);
                const importedEol = Number.parseInt(row[headerMap['อายุการใช้งานที่คาดการณ์ (ปี)']] || 0);

                // บันทึก Asset Data: ใช้ข้อมูลจากแถวแรกที่พบสำหรับอุปกรณ์นั้น
                if (importedInstallDate.length > 0 && !assetsToSave[deviceName]) {
                     assetsToSave[deviceName] = {
                         installDate: importedInstallDate,
                         warrantyYears: importedWarranty,
                         eolYears: importedEol
                     };
                }
                // ====================================================================

                // โค้ดเดิม: 2. ประมวลผลข้อมูลประวัติการชำรุด (Breakdown History)
                const statusValue = (row[headerMap['สถานะ']] || '').toString();
                const importedBrokenDate = (row[headerMap['วันที่ชำรุด']] || '').toString().slice(0, 10);
                const importedFixedDate = (row[headerMap['วันที่ซ่อมแซม']] || '').toString().slice(0, 10);
                
                const fixedDateValue = importedFixedDate.length > 0 ? importedFixedDate : null;

                const record = {
                    ts: Date.now() + i, 
                    brokenDate: importedBrokenDate,
                    fixedDate: fixedDateValue, 
                    status: statusValue.includes('ชำรุด') ? 'down' : 'ok',
                    description: (row[headerMap['คำอธิบาย']] || '').toString() || 'นำเข้าจาก Excel',
                    user: (row[headerMap['ผู้บันทึก']] || '').toString() || 'ImportTool', 
                    counted: !!importedBrokenDate, 
                };

                // 💡 บังคับสถานะเป็น 'down' หากยังไม่ซ่อม
                if (record.brokenDate && record.fixedDate === null) {
                    record.status = 'down';
                }

                if (!recordsToSave[deviceName])
	              {recordsToSave[deviceName] = [];}
                recordsToSave[deviceName].push(record);
            }
            
            
            // ====================================================================
            // 💡 NEW BATCH 1: บันทึกข้อมูลทะเบียนทรัพย์สิน (Asset Registration)
            // ====================================================================
            const assetBatch = db.batch();
            let totalAssetsUpdated = 0;
            const assetRegDocRef = db.collection('asset_registration').doc(currentSiteKey);

            Object.keys(assetsToSave).forEach(deviceName => {
                const assetData = assetsToSave[deviceName];
                if (assetData && assetData.installDate.length > 0) {
                     assetBatch.set(
                         assetRegDocRef,
                         { [deviceName]: assetData }, 
                         { merge: true }
                     );
                     totalAssetsUpdated++;
                }
            });
            
            // Commit Asset Batch (ดำเนินการแบบ Asynchronous)
            if (totalAssetsUpdated > 0) {
                 assetBatch.commit().then(() => {
                     console.log(`Successfully updated asset registration for ${totalAssetsUpdated} devices.`);
                 }).catch(error => {
                     console.error("Error writing asset batch: ", error);
                     Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการบันทึกข้อมูลทะเบียนทรัพย์สิน: ' + error.message, 'error');
                 });
            }
            // ====================================================================


            // โค้ดเดิม: BATCH 2: บันทึกข้อมูลประวัติการชำรุด (Breakdown History)
            const historyBatch = db.batch();
            let totalRecords = 0;

            Object.keys(recordsToSave).forEach(deviceName => {
                // 💡 สมมติว่า getSiteCollection(currentSiteKey) คือ Reference ไปยัง collection devices
                const deviceRef = getSiteCollection(currentSiteKey).doc(deviceName);
                const newRecords = recordsToSave[deviceName];
                totalRecords += newRecords.length;

                historyBatch.set(
                    deviceRef,
                    { records: firebase.firestore.FieldValue.arrayUnion(...newRecords) },
                    { merge: true }
                );
            });

            if (totalRecords > 0) {
                historyBatch.commit().then(() => {
                    
                    window.updateAllAffectedDevicesSummary(Object.keys(recordsToSave)); 
                    
                    Swal.fire({
                        title: 'นำเข้าสำเร็จ!',
                        text: `นำเข้ารายการบันทึกทั้งหมด ${totalRecords} รายการ และอัปเดตทะเบียนทรัพย์สิน ${totalAssetsUpdated} รายการ`,
                        icon: 'success',
                        confirmButtonText: 'ตกลง'
                    });

                }).catch(error => {
                    console.error("Error writing batch: ", error);
                    Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการบันทึกประวัติชำรุด: ' + error.message, 'error');
                });
            } else if (totalAssetsUpdated > 0) {
                 // กรณีที่อัปเดต Asset Data สำเร็จ แต่ไม่มี History Record
                 Swal.fire({
                        title: 'นำเข้าสำเร็จ!',
                        text: `อัปเดตทะเบียนทรัพย์สิน ${totalAssetsUpdated} รายการ (ไม่มีประวัติการชำรุดใหม่)`,
                        icon: 'success',
                        confirmButtonText: 'ตกลง'
                    });
            } else {
                Swal.fire('ผิดพลาด', 'ไม่พบรายการบันทึกหรือข้อมูลทะเบียนที่ถูกต้องสำหรับการนำเข้า', 'error');
            }


        } catch (error) {
            console.error("Import Error: ", error);
            Swal.fire('ผิดพลาด', 'เกิดข้อผิดพลาดในการอ่านไฟล์: ' + error.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
};
window.exportAllDataExcel = async function() {
    const siteData = sites[currentSiteKey];
    if (!siteData || siteData.devices.length === 0) {
        // 💡 หากมี SweetAlert2 ให้ใช้ Swal.fire
        // Swal.fire('แจ้งเตือน', 'ไม่พบอุปกรณ์ในไซต์งานปัจจุบันสำหรับการส่งออก', 'warning');
        return;
    }
    
    // ====================================================================
    // 💡 NEW: ดึงข้อมูลทะเบียนทรัพย์สินทั้งหมด
    // ====================================================================
    const assetRegDocRef = db.collection('asset_registration').doc(currentSiteKey);
    const assetRegDoc = await assetRegDocRef.get();
    const allAssetData = assetRegDoc.exists ? assetRegDoc.data() : {};
    // ====================================================================

    // โค้ดเดิม: ดึงข้อมูลประวัติการชำรุดทั้งหมด
    const docsSnap = await getAllDevicesDocs(currentSiteKey);
    const dataMap = {};
    docsSnap.forEach(d => dataMap[d.id] = d.data());

    // Header (เพิ่มคอลัมน์ใหม่)
    const header = [
        'ชื่ออุปกรณ์',
        'วันที่ติดตั้ง', // 💡 NEW
        'ระยะเวลารับประกัน (ปี)', // 💡 NEW
        'อายุการใช้งานที่คาดการณ์ (ปี)', // 💡 NEW
        'สถานะการแจ้งเตือนทรัพย์สิน', // 💡 NEW
        'วันที่ชำรุด',
        'วันที่ซ่อมแซม',
        'ระยะเวลาชำรุด',
        'สถานะ',
        'คำอธิบาย',
        'ผู้บันทึก'
    ];
    const data = [];

    for (const devName of siteData.devices) {
        const docData = dataMap[devName];
        
        // 💡 NEW: ดึงข้อมูลทะเบียนทรัพย์สินสำหรับอุปกรณ์นี้และคำนวณสถานะ
        const assetData = allAssetData[devName] || {};
        const assetStatus = calculateAssetStatus(devName, assetData);

        // จัดเตรียมข้อมูลทะเบียนทรัพย์สิน
        const installDate = assetData.installDate || '-';
        const warrantyYears = assetData.warrantyYears || '-';
        const eolYears = assetData.eolYears || '-';
        const statusMessage = assetStatus.message;
        
        const records = docData?.records || [];
        
        if (records.length === 0) {
            // กรณีที่มีข้อมูลทะเบียน แต่ไม่มีประวัติชำรุด (สำคัญ: ต้องส่งออกรายการนี้ด้วย)
            data.push([
                devName,
                installDate,
                warrantyYears,
                eolYears,
                statusMessage,
                '-', // brokenDate
                '-', // fixedDate
                '-', // duration
                '-', // status
                '-', // description
                '-', // user
            ]);
            continue;
        }

        // Loop ผ่านประวัติการชำรุด
        records.forEach(r => {
            
            let duration = '-';
            
            if (r.brokenDate) {
                if (r.fixedDate) {
                    const days = calculateDaysDifference(r.brokenDate, r.fixedDate);
                    duration = formatDuration(days);
                } else if (r.status === 'down') {
                    const days = calculateDaysDifference(r.brokenDate, null);
                    duration = formatDuration(days) + ' (ชำรุด)';
                }
            }
            
            // 💡 NEW: เพิ่มข้อมูลทะเบียนทรัพย์สินและสถานะเข้าไปในแถวข้อมูล
            data.push([
                devName,
                installDate, // 💡 NEW
                warrantyYears, // 💡 NEW
                eolYears, // 💡 NEW
                statusMessage, // 💡 NEW
                r.brokenDate || '-',
                r.fixedDate || '-',
                duration,
                r.status === 'down' ? 'ชำรุด' : 'ใช้งานได้',
                r.description || '-',
                r.user || '-',
            ]);
        });
    }

    if (data.length === 0) {
        // 💡 หากมี SweetAlert2 ให้ใช้ Swal.fire
        // Swal.fire('แจ้งเตือน', 'ไม่พบรายการบันทึกการชำรุดในไซต์งานปัจจุบันสำหรับการส่งออก', 'warning');
        return;
    }

    // Assume XLSX library is loaded
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DeviceRecords");

    const fileName = `Device_Records_Export_${siteData.name.replace(/\s/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);

    alert('ส่งออกข้อมูลเรียบร้อยแล้ว');
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
        
        switchSite(initialSiteKey); 
        
    } catch (error) {
         console.error("Initial Site Switch Error:", error);
          // 💡 หากมี SweetAlert2 ให้ใช้ Swal.fire
         // Swal.fire('ข้อผิดพลาด', 'เกิดข้อผิดพลาดในการเริ่มต้นระบบ: ' + error.message, 'error');
    }
});

window.onload = function() {
    try { imageMapResize(); } catch (e) {}
    

};

