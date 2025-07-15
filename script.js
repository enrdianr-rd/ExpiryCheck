// Service Worker & Notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .catch(console.error);
}
if ('Notification' in window) {
  Notification.requestPermission();
}

// DOM Elements
const form = document.getElementById('itemForm'),
      itemList = document.getElementById('itemList'),
      sortBy = document.getElementById('sortBy'),
      filterBy = document.getElementById('filterBy'),
      exportBtn = document.getElementById('exportBtn'),
      importFile = document.getElementById('importFile'),
      clearArchive = document.getElementById('clearArchive'),
      suggestions = document.getElementById('suggestions'),
      chartCtx = document.getElementById('chart').getContext('2d'),
      toggleDark = document.getElementById('toggleDarkMode'),
      dateInput = document.getElementById('expirationDate');

// Set default date to tomorrow and prevent past dates
const today = new Date();
const tomorrow = new Date(Date.now() + 86400000);
dateInput.value = tomorrow.toISOString().slice(0,10);
dateInput.min = today.toISOString().slice(0,10);

// Storage Utilities
const getItems = () => JSON.parse(localStorage.getItem('items')) || [];
const setItems = arr => localStorage.setItem('items', JSON.stringify(arr));
const getArchive = () => JSON.parse(localStorage.getItem('archive')) || [];
const setArchive = arr => localStorage.setItem('archive', JSON.stringify(arr));

// Notification helper
const notify = (name, days) => {
  if (Notification.permission === 'granted') {
    new Notification(`${name} expires in ${days} day${days > 1 ? 's' : ''}!`);
  }
};

// Populate autocomplete suggestions
function populateSuggestions() {
  const names = [...new Set(getItems().map(i => i.name))];
  suggestions.innerHTML = names.map(n => `<option value="${n}">`).join('');
}

let chart;

// Render items list
function renderItems() {
  let items = getItems(), archive = getArchive(), now = new Date();

  // Archive expired items
  items = items.filter(it => {
    if (new Date(it.date) < now) {
      archive.push(it);
      return false;
    }
    return true;
  });
  setArchive(archive);
  setItems(items);

  // Build view with days until expiry
  let view = items.map((it, idx) => ({
    ...it,
    idx,
    diffDays: Math.ceil((new Date(it.date) - now) / (1000 * 60 * 60 * 24))
  }));

  // Apply filter
  const f = filterBy.value;
  view = view.filter(it => {
    if (f === 'soon') return it.diffDays >= 0 && it.diffDays <= 7;
    if (f === 'expired') return it.diffDays < 0;
    if (f === 'safe') return it.diffDays > 7;
    return true;
  });

  // Apply sorting
  if (sortBy.value === 'name') view.sort((a,b) => a.name.localeCompare(b.name));
  if (sortBy.value === 'date') view.sort((a,b) => new Date(a.date) - new Date(b.date));
  if (sortBy.value === 'department') view.sort((a,b) => a.department.localeCompare(b.department));

  // Render list
  itemList.innerHTML = '';
  if (view.length > 0) {
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = '<div>Dept</div><div>Item</div><div>Expiry</div><div>Scan</div><div>Delete</div>';
    itemList.appendChild(header);
  }

  view.forEach(v => {
    if (!v.notified && v.diffDays >= 0 && v.diffDays <= 7) {
      notify(v.name, v.diffDays);
      const all = getItems();
      all[v.idx].notified = true;
      setItems(all);
    }

    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `
      <div>${v.department}</div>
      <div>${v.name}</div>
      <div>${v.date}${(v.diffDays >= 0 && v.diffDays <= 7) ? ` <span class="alert">⚠️${v.diffDays}d</span>` : ''}</div>
      <div><button class="scan-btn" data-idx="${v.idx}">📷</button></div>
      <div><button data-idx="${v.idx}">✕</button></div>
    `;
    row.querySelector('button:not(.scan-btn)').onclick = () => {
      const arr = getItems();
      arr.splice(v.idx, 1);
      setItems(arr);
      renderItems();
    };
    row.querySelector('.scan-btn').onclick = () => openScannerModal(v.idx);
    itemList.appendChild(row);
  });

  renderChart(view);
}

// Render color-coded bar chart
function renderChart(data) {
  const now = new Date();
  const upcoming = 10;
  const counts = {};

  // Create date range
  for (let i = 0; i <= upcoming; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = d.toISOString().slice(0,10);
    counts[key] = 0;
  }

  // Count expiries
  data.forEach(item => {
    if (item.diffDays >= 0 && item.diffDays <= upcoming) {
      counts[item.date] = (counts[item.date] || 0) + 1;
    }
  });

  const labels = Object.keys(counts);
  const values = labels.map(d => counts[d]);

  const backgroundColor = labels.map(label => {
    const d = new Date(label);
    const diff = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    if (diff >= 8) return 'pink';
    if (diff >= 5) return 'orange';
    if (diff >= 1) return 'red';
    return '#ccc';
  });

  if (chart) chart.destroy();
  chart = new Chart(chartCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Expiring Items',
        data: values,
        backgroundColor
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: { title: { display: true, text: 'Expiry Date' } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// Barcode Scanner logic
function openScannerModal(idx) {
  document.getElementById('scanner').style.display = 'block';
  Quagga.start();
  Quagga.onDetected(data => {
    const code = data.codeResult.code;
    const arr = getItems();
    arr[idx].name = code;
    setItems(arr);
    Quagga.stop();
    document.getElementById('scanner').style.display = 'none';
    renderItems();
  });
}

Quagga.init({
  inputStream: { type: "LiveStream", target: "#scanner" },
  decoder: { readers: ["ean_reader"] }
}, err => {
  if (!err) Quagga.stop();
});

// Handle form submission
form.onsubmit = e => {
  e.preventDefault();
  const dept = form.department.value,
        name = form.itemName.value.trim(),
        date = form.expirationDate.value;
  if (!dept || !name || !date) return;

  const arr = getItems();
  arr.push({ department: dept, name, date, notified: false });
  setItems(arr);

  form.reset();
  dateInput.value = new Date(Date.now() + 86400000).toISOString().slice(0,10);
  populateSuggestions();
  renderItems();
};

[sortBy, filterBy].forEach(el => el.onchange = renderItems);

// Export / Import / Clear archive
exportBtn.onclick = () => {
  const blob = new Blob([JSON.stringify(getItems(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'items.json';
  a.click();
};

importFile.onchange = e => {
  const reader = new FileReader();
  reader.onload = () => {
    setItems(JSON.parse(reader.result));
    populateSuggestions();
    renderItems();
  };
  reader.readAsText(e.target.files[0]);
};

clearArchive.onclick = () => {
  localStorage.removeItem('archive');
  alert('Archive cleared');
};

// Dark mode toggle
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
toggleDark.onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};

// Initialize
populateSuggestions();
renderItems();
