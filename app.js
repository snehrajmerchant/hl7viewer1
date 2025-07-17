// Check if PDF.js is loaded
let pdfjsLoaded = false;

// Function to check and load PDF.js if needed
async function ensurePDFjsLoaded() {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLoaded = true;
    return true;
  }
  
  // Try to load PDF.js dynamically
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      pdfjsLoaded = true;
      resolve(true);
    };
    script.onerror = () => {
      console.error('Failed to load PDF.js from CDN');
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

// Floating action button logic
const loadBtn = document.getElementById('loadBtn');
const fileInput = document.getElementById('fileInput');
const segmentsList = document.getElementById('segmentsList');
const segmentDetails = document.getElementById('segmentDetails');
const selectedFileName = document.getElementById('selectedFileName');

// Resizer functionality
const resizer = document.getElementById('resizer');
const segmentsPanel = document.getElementById('segmentsPanel');
const detailsPanel = document.getElementById('detailsPanel');

let isResizing = false;
let startX;
let startWidth;

function initResizer() {
  resizer.addEventListener('mousedown', startResize);
  document.addEventListener('mousemove', resize);
  document.addEventListener('mouseup', stopResize);
}

function startResize(e) {
  isResizing = true;
  startX = e.clientX;
  startWidth = segmentsPanel.offsetWidth;
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
}

function resize(e) {
  if (!isResizing) return;
  
  const deltaX = e.clientX - startX;
  const newWidth = Math.max(300, Math.min(800, startWidth + deltaX));
  
  segmentsPanel.style.width = newWidth + 'px';
  segmentsPanel.style.flex = 'none';
}

function stopResize() {
  isResizing = false;
  document.body.style.cursor = '';
}

// Initialize resizer when DOM is loaded
document.addEventListener('DOMContentLoaded', initResizer);

loadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFile);

let hl7Segments = [];
let selectedIdx = null;

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  // Show file name and path in header
  if (selectedFileName) {
    selectedFileName.textContent = file.webkitRelativePath || file.name;
  }
  const reader = new FileReader();
  reader.onload = function(evt) {
    const text = evt.target.result;
    parseHL7(text);
    renderSegments();
    segmentDetails.innerHTML = 'Select a segment to view details.';
  };
  reader.readAsText(file);
}

function parseHL7(text) {
  // HL7 segments can be separated by different characters
  // Try multiple approaches to handle various HL7 file formats
  
  let segments = [];
  
  // First, try splitting by carriage return + line feed (Windows)
  if (text.includes('\r\n')) {
    segments = text.split('\r\n');
  }
  // Then try just line feed (Unix/Linux)
  else if (text.includes('\n')) {
    segments = text.split('\n');
  }
  // Then try just carriage return (old Mac)
  else if (text.includes('\r')) {
    segments = text.split('\r');
  }
  // If none of the above, the entire text might be one segment
  else {
    segments = [text];
  }
  
  // Filter out empty lines and trim whitespace
  hl7Segments = segments
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function renderSegments() {
  segmentsList.innerHTML = '';

  if (hl7Segments.length === 0) {
    segmentsList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">No segments found</div>';
    return;
  }

  hl7Segments.forEach((seg, idx) => {
    const segType = seg.split('|')[0];
    const rest = seg.substring(segType.length);
    const card = document.createElement('div');
    card.className = 'segment-card' + (selectedIdx === idx ? ' selected' : '');

    // Show segment type in red, rest in monospace
    const preview = seg.length > 80 ? seg.substring(0, 80) + '...' : seg;
    const previewType = preview.split('|')[0];
    const previewRest = preview.substring(previewType.length);
    card.innerHTML = `
      <span class="segment-type">${escapeHtml(previewType)}</span><span style="font-size: 0.95em; color: #666; font-family: 'Courier New', monospace;">${escapeHtml(previewRest)}</span>
    `;
    card.title = seg;
    card.onclick = () => selectSegment(idx);
    segmentsList.appendChild(card);
  });
}

function selectSegment(idx) {
  selectedIdx = idx;
  renderSegments();
  const seg = hl7Segments[idx];
  showSegmentDetails(seg);
}

function showSegmentDetails(segment) {
  const fields = segment.split('|');
  const segType = fields[0];
  let html = `<div class="card"><h3>${segType} Segment</h3><table style="width: 100%; border-collapse: collapse;">`;
  
  fields.forEach((field, i) => {
    const fieldName = getFieldName(segType, i);
    const fieldLabel = fieldName || `${segType}${i}`;
    
    // Check if this field contains PDF data that should be hidden
    let fieldValue = field;
    let shouldHide = false;
    
    if (segType === 'OBX' && i === 5) {
      // Check if OBX5 contains PDF data
      if (field && (field.includes('Application^PDF^^Base64') || field.includes('Application^PDF^^Base64^') || /^JVBERi0xL/.test(field))) {
        fieldValue = '[PDF Data - See viewer below]';
        shouldHide = true;
      }
    } else if (field && /^JVBERi0xL/.test(field)) {
      // Check other fields for direct base64 PDF data
      fieldValue = '[PDF Data - See viewer below]';
      shouldHide = true;
    }
    
    html += `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 4px 8px; font-weight: bold; width: 180px; vertical-align: top; font-size: 0.8em;">${fieldLabel}</td>
        <td style="padding: 4px 8px; word-break: break-word; font-size: 0.8em; ${shouldHide ? 'color: #999; font-style: italic;' : ''} ${!fieldValue ? 'background-color: #f5f5f5;' : ''}">${escapeHtml(fieldValue || '')}</td>
      </tr>
    `;
  });
  html += '</table></div>';

  // Check for base64 PDF in OBX segments
  let pdfFieldIdx = -1;
  let base64Data = null;
  
  // Look for OBX segments with PDF data
  if (segType === 'OBX') {
    // Check field 5 (Observation Value) for PDF data
    if (fields.length > 5) {
      const obx5 = fields[5];
      
              // Check if it contains Application^PDF^^Base64 format (with or without trailing ^)
        if (obx5 && (obx5.includes('Application^PDF^^Base64') || obx5.includes('Application^PDF^^Base64^'))) {
          // Extract the base64 data after the format specifier
          const parts = obx5.split('^');
        
                  // Look for the part that contains actual base64 data (starts with JVBERi0xL)
          for (let i = 0; i < parts.length; i++) {
            if (parts[i] && /^JVBERi0xL/.test(parts[i])) {
              base64Data = parts[i];
              pdfFieldIdx = 5;
              break;
            }
          }
        
                  // If no JVBERi0xL found, try the 4th part as fallback
          if (!base64Data && parts.length >= 4) {
            base64Data = parts[3];
            pdfFieldIdx = 5;
          }
      }
              // Also check for direct base64 data starting with JVBERi0xL
        else if (obx5 && /^JVBERi0xL/.test(obx5)) {
          base64Data = obx5;
          pdfFieldIdx = 5;
        }
              // Check if any part of the field contains base64 data
        else if (obx5) {
          const parts = obx5.split('^');
          for (let i = 0; i < parts.length; i++) {
            if (parts[i] && /^JVBERi0xL/.test(parts[i])) {
              base64Data = parts[i];
              pdfFieldIdx = 5;
              break;
            }
          }
        }
    }
  }
  // Check other segments for direct base64 PDF data
  else {
    pdfFieldIdx = fields.findIndex(f => /^JVBERi0xL/.test(f));
    if (pdfFieldIdx !== -1) {
      base64Data = fields[pdfFieldIdx];
    }
  }
  
  if (pdfFieldIdx !== -1 && base64Data) {
    html += `
      <div class="pdf-viewer" id="pdfViewer">
        <div class="pdf-controls">
          <button class="pdf-arrow" id="prevPageBtn">&#60;</button>
          <span id="pageInfo">Page <span id="pageNum">1</span> / <span id="pageCount">?</span></span>
          <button class="pdf-arrow" id="nextPageBtn">&#62;</button>
        </div>
        <div class="pdf-view-controls">
          <button class="pdf-view-btn active" id="pageWidthBtn" onclick="setPdfView('width')">Page Width</button>
          <button class="pdf-view-btn" id="fullPageBtn" onclick="setPdfView('full')">Full Page</button>
        </div>
        <canvas id="pdfCanvas"></canvas>
      </div>
    `;
  }

  segmentDetails.innerHTML = html;

  if (pdfFieldIdx !== -1 && base64Data) {
    renderPDF(base64Data);
  }
}

// PDF.js rendering logic
let pdfDoc = null;
let currentPage = 1;
let totalPages = 1;
let pdfViewMode = 'width'; // 'width' or 'full'

async function renderPDF(base64) {
  
  try {
    // Ensure PDF.js is loaded
    const pdfjsAvailable = await ensurePDFjsLoaded();
    if (!pdfjsAvailable) {
      throw new Error('Failed to load PDF.js library. Please check your internet connection and try again.');
    }
    
    // Check if PDF.js is available
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not loaded. Please refresh the page and try again.');
    }
    
    const pdfData = atob(base64);
    
    // Convert binary string to Uint8Array
    const uint8Array = new Uint8Array(pdfData.length);
    for (let i = 0; i < pdfData.length; i++) {
      uint8Array[i] = pdfData.charCodeAt(i);
    }

    // Load PDF
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    pdfDoc = await pdfjsLib.getDocument({data: uint8Array}).promise;
    totalPages = pdfDoc.numPages;
    currentPage = 1;
    document.getElementById('pageCount').textContent = totalPages;
    renderPage(currentPage);

    document.getElementById('prevPageBtn').onclick = () => {
      if (currentPage > 1) {
        currentPage--;
        renderPage(currentPage);
      }
    };
    document.getElementById('nextPageBtn').onclick = () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderPage(currentPage);
      }
    };
    updateNavButtons();
  } catch (error) {
    console.error('Error rendering PDF:', error);
    const pdfViewer = document.getElementById('pdfViewer');
    if (pdfViewer) {
      if (error.message.includes('PDF.js library not loaded') || error.message.includes('Failed to load PDF.js')) {
        pdfViewer.innerHTML = `
          <div style="color: white; text-align: center; padding: 20px;">
            <div style="margin-bottom: 15px; font-size: 1.1em;">PDF Detected Successfully!</div>
            <div style="margin-bottom: 20px; color: #ccc;">PDF.js library could not be loaded for inline viewing.</div>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
              <a href="data:application/pdf;base64,${base64}" target="_blank" style="padding: 10px 16px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; display: inline-block;">
                📄 Open PDF in New Tab
              </a>
              <a href="data:application/pdf;base64,${base64}" download="document.pdf" style="padding: 10px 16px; background: #1976d2; color: white; text-decoration: none; border-radius: 4px; display: inline-block;">
                💾 Download PDF File
              </a>
              <button onclick="retryPDFLoad('${base64}')" style="padding: 10px 16px; background: #FF9800; color: white; border: none; border-radius: 4px; cursor: pointer;">
                🔄 Retry Inline View
              </button>
            </div>
            <div style="margin-top: 15px; color: #ccc; font-size: 0.9em;">
              Note: When opened in a new tab, you can use your browser's built-in PDF navigation controls.
            </div>
          </div>
        `;
      } else {
        pdfViewer.innerHTML = `
          <div style="color: white; text-align: center; padding: 20px;">
            <div style="margin-bottom: 15px; font-size: 1.1em;">PDF Detected Successfully!</div>
            <div style="margin-bottom: 20px; color: #ccc;">Error loading PDF for inline viewing: ${error.message}</div>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
              <a href="data:application/pdf;base64,${base64}" target="_blank" style="padding: 10px 16px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px; display: inline-block;">
                📄 Open PDF in New Tab
              </a>
              <a href="data:application/pdf;base64,${base64}" download="document.pdf" style="padding: 10px 16px; background: #1976d2; color: white; text-decoration: none; border-radius: 4px; display: inline-block;">
                💾 Download PDF File
              </a>
            </div>
          </div>
        `;
      }
    }
  }
}

async function renderPage(num) {
  const page = await pdfDoc.getPage(num);
  const canvas = document.getElementById('pdfCanvas');
  const ctx = canvas.getContext('2d');
  
  // Calculate scale based on view mode
  const container = document.getElementById('pdfViewer');
  const containerWidth = container ? container.clientWidth - 32 : 800;
  const containerHeight = container ? container.clientHeight - 100 : 600; // Account for controls
  const viewport = page.getViewport({scale: 1.0});
  
  let scale;
  if (pdfViewMode === 'width') {
    // Page width view - make PDF fill the full container width (no limit)
    scale = containerWidth / viewport.width;
    canvas.classList.remove('pdf-fullpage');
  } else {
    // Full page view - fit to container height while maintaining aspect ratio
    const heightScale = (window.innerHeight * 0.85) / viewport.height;
    const widthScale = containerWidth / viewport.width;
    scale = Math.min(heightScale, widthScale, 1.0); // Limit to 1.0x for full page
    canvas.classList.add('pdf-fullpage');
  }
  
  const scaledViewport = page.getViewport({scale: scale});
  
  // Set canvas size to the scaled PDF dimensions
  canvas.height = scaledViewport.height;
  canvas.width = scaledViewport.width;
  
  // Apply CSS to constrain canvas to container
  if (pdfViewMode === 'width') {
    // Page width mode - allow vertical scrolling for larger PDFs
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.maxHeight = 'none'; // Allow full height
  } else {
    // Full page mode - fit within container while maintaining aspect ratio
    canvas.style.width = 'auto';
    canvas.style.height = 'auto';
    canvas.style.maxWidth = '100%';
    // maxHeight is handled by the .pdf-fullpage class
  }

  await page.render({canvasContext: ctx, viewport: scaledViewport}).promise;
  document.getElementById('pageNum').textContent = num;
  
  // Update view mode indicator
  const viewIndicator = document.getElementById('pageInfo');
  if (viewIndicator) {
    const modeText = pdfViewMode === 'width' ? ' (Page Width)' : ' (Full Page)';
    viewIndicator.innerHTML = `Page <span id="pageNum">${num}</span> / <span id="pageCount">${totalPages}</span>${modeText}`;
  }
  
  updateNavButtons();
}

// Responsive: re-render PDF on window resize
window.addEventListener('resize', () => {
  if (pdfDoc && currentPage) {
    renderPage(currentPage);
  }
});

function updateNavButtons() {
  document.getElementById('prevPageBtn').disabled = currentPage <= 1;
  document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
}

// Retry function for PDF loading
async function retryPDFLoad(base64) {
  await renderPDF(base64);
}

// Function to set PDF view mode
async function setPdfView(mode) {
  if (pdfViewMode === mode) {
    return; // No change needed
  }
  
  pdfViewMode = mode;
  
  // Update button states
  document.getElementById('pageWidthBtn').classList.toggle('active', mode === 'width');
  document.getElementById('fullPageBtn').classList.toggle('active', mode === 'full');
  
  // Re-render current page with new view mode
  if (pdfDoc && currentPage) {
    await renderPage(currentPage);
  }
}

function isBase64PDF(fields) {
  // Check for base64 PDF in various HL7 formats
  return fields.some(f => {
    // Direct base64 PDF data
    if (/^JVBERi0xL/.test(f)) {
      return true;
    }
    // OBX format: Application^PDF^^Base64 (with or without trailing ^)
    if (f && (f.includes('Application^PDF^^Base64') || f.includes('Application^PDF^^Base64^'))) {
      return true;
    }
    return false;
  });
}

function getFieldName(segmentType, fieldIndex) {
  const fieldNames = {
    'MSH': {
      1: 'MSH1 - Field Separator',
      2: 'MSH2 - Encoding Characters',
      3: 'MSH3 - Sending Application',
      4: 'MSH4 - Sending Facility',
      5: 'MSH5 - Receiving Application',
      6: 'MSH6 - Receiving Facility',
      7: 'MSH7 - Date/Time',
      8: 'MSH8 - Security',
      9: 'MSH9 - Message Type',
      10: 'MSH10 - Message Control ID',
      11: 'MSH11 - Processing ID',
      12: 'MSH12 - Version ID',
      13: 'MSH13 - Sequence Number',
      14: 'MSH14 - Continuation Pointer',
      15: 'MSH15 - Accept Acknowledgment Type',
      16: 'MSH16 - Application Acknowledgment Type',
      17: 'MSH17 - Country Code',
      18: 'MSH18 - Character Set',
      19: 'MSH19 - Principal Language',
      20: 'MSH20 - Alternate Character Set'
    },
    'EVN': {
      1: 'EVN1 - Event Type Code',
      2: 'EVN2 - Recorded Date/Time',
      3: 'EVN3 - Date/Time Planned Event',
      4: 'EVN4 - Event Reason Code',
      5: 'EVN5 - Operator ID',
      6: 'EVN6 - Event Occurred',
      7: 'EVN7 - Event Facility'
    },
    'PID': {
      1: 'PID1 - Set ID',
      2: 'PID2 - Patient ID',
      3: 'PID3 - Patient Identifier List',
      4: 'PID4 - Alternate Patient ID',
      5: 'PID5 - Patient Name',
      6: 'PID6 - Mother\'s Maiden Name',
      7: 'PID7 - Date/Time of Birth',
      8: 'PID8 - Sex',
      9: 'PID9 - Patient Alias',
      10: 'PID10 - Race',
      11: 'PID11 - Patient Address',
      12: 'PID12 - County Code',
      13: 'PID13 - Phone Number - Home',
      14: 'PID14 - Phone Number - Business',
      15: 'PID15 - Primary Language',
      16: 'PID16 - Marital Status',
      17: 'PID17 - Religion',
      18: 'PID18 - Patient Account Number',
      19: 'PID19 - SSN Number',
      20: 'PID20 - Driver\'s License Number',
      21: 'PID21 - Mother\'s Identifier',
      22: 'PID22 - Ethnic Group',
      23: 'PID23 - Birth Place',
      24: 'PID24 - Multiple Birth Indicator',
      25: 'PID25 - Birth Order',
      26: 'PID26 - Citizenship',
      27: 'PID27 - Veterans Military Status',
      28: 'PID28 - Nationality',
      29: 'PID29 - Patient Death Date and Time',
      30: 'PID30 - Patient Death Indicator'
    },
    'NK1': {
      1: 'NK1-1 - Set ID',
      2: 'NK1-2 - Name',
      3: 'NK1-3 - Relationship',
      4: 'NK1-4 - Address',
      5: 'NK1-5 - Phone Number',
      6: 'NK1-6 - Business Phone Number',
      7: 'NK1-7 - Contact Role',
      8: 'NK1-8 - Start Date',
      9: 'NK1-9 - End Date',
      10: 'NK1-10 - Next of Kin/Associated Parties Job Title'
    },
    'PV1': {
      1: 'PV1 - Set ID',
      2: 'PV1 - Patient Class',
      3: 'PV1 - Assigned Patient Location',
      4: 'PV1 - Admission Type',
      5: 'PV1 - Preadmit Number',
      6: 'PV1 - Prior Patient Location',
      7: 'PV1 - Attending Physician',
      8: 'PV1 - Referring Physician',
      9: 'PV1 - Consulting Physician',
      10: 'PV1 - Hospital Service',
      11: 'PV1 - Temporary Location',
      12: 'PV1 - Preadmit Test Indicator',
      13: 'PV1 - Readmission Indicator',
      14: 'PV1 - Admit Source',
      15: 'PV1 - Ambulatory Status',
      16: 'PV1 - VIP Indicator',
      17: 'PV1 - Admitting Physician',
      18: 'PV1 - Patient Type',
      19: 'PV1 - Visit Number',
      20: 'PV1 - Financial Class',
      21: 'PV1 - Charge Price Indicator',
      22: 'PV1 - Courtesy Code',
      23: 'PV1 - Credit Rating',
      24: 'PV1 - Contract Code',
      25: 'PV1 - Contract Effective Date',
      26: 'PV1 - Contract Amount',
      27: 'PV1 - Contract Period',
      28: 'PV1 - Interest Code',
      29: 'PV1 - Transfer to Bad Debt Code',
      30: 'PV1 - Transfer to Bad Debt Date',
      31: 'PV1 - Bad Debt Agency Code',
      32: 'PV1 - Bad Debt Transfer Amount',
      33: 'PV1 - Bad Debt Recovery Amount',
      34: 'PV1 - Delete Account Indicator',
      35: 'PV1 - Delete Account Date',
      36: 'PV1 - Discharge Disposition',
      37: 'PV1 - Discharged to Location',
      38: 'PV1 - Diet Type',
      39: 'PV1 - Servicing Facility',
      40: 'PV1 - Bed Status',
      41: 'PV1 - Account Status',
      42: 'PV1 - Pending Location',
      43: 'PV1 - Prior Temporary Location',
      44: 'PV1 - Admit Date/Time',
      45: 'PV1 - Discharge Date/Time',
      46: 'PV1 - Current Patient Balance',
      47: 'PV1 - Total Charges',
      48: 'PV1 - Total Adjustments',
      49: 'PV1 - Total Payments',
      50: 'PV1 - Alternate Visit ID',
      51: 'PV1 - Visit Indicator',
      52: 'PV1 - Other Healthcare Provider'
    },
    'PV2': {
      1: 'PV2-1 - Prior Pending Location',
      2: 'PV2-2 - Accommodation Code',
      3: 'PV2-3 - Admit Reason',
      4: 'PV2-4 - Transfer Reason',
      5: 'PV2-5 - Patient Valuables',
      6: 'PV2-6 - Patient Valuables Location',
      7: 'PV2-7 - Visit User Code',
      8: 'PV2-8 - Expected Admit Date/Time',
      9: 'PV2-9 - Expected Discharge Date/Time',
      10: 'PV2-10 - Estimated Length of Inpatient Stay'
    },
    'AL1': {
      1: 'AL1-1 - Set ID',
      2: 'AL1-2 - Allergy Type',
      3: 'AL1-3 - Allergy Code/Mnemonic/Description',
      4: 'AL1-4 - Allergy Severity',
      5: 'AL1-5 - Allergy Reaction',
      6: 'AL1-6 - Identification Date'
    },
    'DG1': {
      1: 'DG1-1 - Set ID',
      2: 'DG1-2 - Diagnosis Coding Method',
      3: 'DG1-3 - Diagnosis Code',
      4: 'DG1-4 - Diagnosis Description',
      5: 'DG1-5 - Diagnosis Date/Time',
      6: 'DG1-6 - Diagnosis Type',
      7: 'DG1-7 - Major Diagnostic Category',
      8: 'DG1-8 - Diagnostic Related Group',
      9: 'DG1-9 - DRG Approval Indicator',
      10: 'DG1-10 - DRG Grouper Review Code'
    },
    'IN1': {
      1: 'IN1-1 - Set ID',
      2: 'IN1-2 - Insurance Plan ID',
      3: 'IN1-3 - Insurance Company ID',
      4: 'IN1-4 - Insurance Company Name',
      5: 'IN1-5 - Insurance Company Address',
      6: 'IN1-6 - Insurance Co. Contact Person',
      7: 'IN1-7 - Insurance Co Phone Number',
      8: 'IN1-8 - Group Number',
      9: 'IN1-9 - Group Name',
      10: 'IN1-10 - Insured\'s Group Emp ID'
    },
    'GT1': {
      1: 'GT1-1 - Set ID',
      2: 'GT1-2 - Guarantor Number',
      3: 'GT1-3 - Guarantor Name',
      4: 'GT1-4 - Guarantor Spouse Name',
      5: 'GT1-5 - Guarantor Address',
      6: 'GT1-6 - Guarantor Phone Number - Home',
      7: 'GT1-7 - Guarantor Phone Number - Business',
      8: 'GT1-8 - Guarantor Date/Time of Birth',
      9: 'GT1-9 - Guarantor Sex',
      10: 'GT1-10 - Guarantor Type'
    },
    'FT1': {
      1: 'FT1-1 - Set ID',
      2: 'FT1-2 - Transaction ID',
      3: 'FT1-3 - Transaction Batch ID',
      4: 'FT1-4 - Transaction Date',
      5: 'FT1-5 - Transaction Posting Date',
      6: 'FT1-6 - Transaction Type',
      7: 'FT1-7 - Transaction Code',
      8: 'FT1-8 - Transaction Description',
      9: 'FT1-9 - Transaction Description Alt',
      10: 'FT1-10 - Transaction Quantity'
    },
    'ORC': {
      1: 'ORC-1 - Order Control',
      2: 'ORC-2 - Placer Order Number',
      3: 'ORC-3 - Filler Order Number',
      4: 'ORC-4 - Placer Group Number',
      5: 'ORC-5 - Order Status',
      6: 'ORC-6 - Response Flag',
      7: 'ORC-7 - Quantity/Timing',
      8: 'ORC-8 - Parent',
      9: 'ORC-9 - Date/Time of Transaction',
      10: 'ORC-10 - Entered By'
    },
    'OBR': {
      1: 'OBR1 - Set ID',
      2: 'OBR2 - Placer Order Number',
      3: 'OBR3 - Filler Order Number',
      4: 'OBR4 - Universal Service ID',
      5: 'OBR5 - Priority',
      6: 'OBR6 - Requested Date/Time',
      7: 'OBR7 - Observation Date/Time',
      8: 'OBR8 - Observation End Date/Time',
      9: 'OBR9 - Collection Volume',
      10: 'OBR10 - Collector Identifier',
      11: 'OBR11 - Specimen Action Code',
      12: 'OBR12 - Danger Code',
      13: 'OBR13 - Relevant Clinical Information',
      14: 'OBR14 - Specimen Received Date/Time',
      15: 'OBR15 - Specimen Source',
      16: 'OBR16 - Ordering Provider',
      17: 'OBR17 - Order Callback Phone Number',
      18: 'OBR18 - Placer Field 1',
      19: 'OBR19 - Placer Field 2',
      20: 'OBR20 - Filler Field 1',
      21: 'OBR21 - Filler Field 2',
      22: 'OBR22 - Results Rpt/Status Chng - Date/Time',
      23: 'OBR23 - Charge to Practice',
      24: 'OBR24 - Diagnostic Service Section ID',
      25: 'OBR25 - Result Status',
      26: 'OBR26 - Parent Result',
      27: 'OBR27 - Quantity/Timing',
      28: 'OBR28 - Result Copies To',
      29: 'OBR29 - Parent',
      30: 'OBR30 - Transportation Mode',
      31: 'OBR31 - Reason for Study',
      32: 'OBR32 - Principal Result Interpreter',
      33: 'OBR33 - Assistant Result Interpreter',
      34: 'OBR34 - Technician',
      35: 'OBR35 - Transcriptionist',
      36: 'OBR36 - Scheduled Date/Time',
      37: 'OBR37 - Number of Sample Containers',
      38: 'OBR38 - Transport Logistics of Collected Sample',
      39: 'OBR39 - Collector\'s Comment',
      40: 'OBR40 - Transport Arrangement Responsibility',
      41: 'OBR41 - Transport Arranged',
      42: 'OBR42 - Escort Required',
      43: 'OBR43 - Planned Patient Transport Comment',
      44: 'OBR44 - Procedure Code',
      45: 'OBR45 - Procedure Code Modifier',
      46: 'OBR46 - Placer Supplemental Service Information',
      47: 'OBR47 - Filler Supplemental Service Information',
      48: 'OBR48 - Medically Necessary Duplicate Procedure Reason',
      49: 'OBR49 - Result Handling',
      50: 'OBR50 - Parent Universal Service Identifier'
    },
    'OBX': {
      1: 'OBX1 - Set ID',
      2: 'OBX2 - Value Type',
      3: 'OBX3 - Observation Identifier',
      4: 'OBX4 - Observation Sub-ID',
      5: 'OBX5 - Observation Value',
      6: 'OBX6 - Units',
      7: 'OBX7 - References Range',
      8: 'OBX8 - Abnormal Flags',
      9: 'OBX9 - Probability',
      10: 'OBX10 - Nature of Abnormal Test',
      11: 'OBX11 - Observation Result Status',
      12: 'OBX12 - Date/Time of the Observation',
      13: 'OBX13 - Producer\'s ID',
      14: 'OBX14 - Responsible Observer',
      15: 'OBX15 - Observation Method',
      16: 'OBX16 - Equipment Instance Identifier',
      17: 'OBX17 - Date/Time of the Analysis',
      18: 'OBX18 - Observation Site',
      19: 'OBX19 - Observation Instance Identifier',
      20: 'OBX20 - Mood Code',
      21: 'OBX21 - Performing Organization Name',
      22: 'OBX22 - Performing Organization Address',
      23: 'OBX23 - Performing Organization Medical Director',
      24: 'OBX24 - Patient Results Release Category',
      25: 'OBX25 - Root Cause',
      26: 'OBX26 - Local Process Control',
      27: 'OBX27 - Observation Type',
      28: 'OBX28 - Observation Sub-type',
      29: 'OBX29 - Observation Value from Parent Result',
      30: 'OBX30 - Observation Value from Child Result'
    }
  };
  // Return the specific field name if available, otherwise return segment-specific format
  return fieldNames[segmentType]?.[fieldIndex] || `${segmentType}${fieldIndex}`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function(tag) {
    const charsToReplace = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return charsToReplace[tag] || tag;
  });
}

// TODO: PDF rendering with PDF.js, page navigation, etc. 