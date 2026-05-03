const PEOPLE = ["Robin", "Anja", "Patrick", "Constance", "Jimmy"];
const GROUPS = {
  dadMom: {
    label: "Dad/Mom",
    members: ["Patrick", "Constance"],
    groceryPortions: 2,
    householdPortions: 2
  },
  robinAnja: {
    label: "Robin & Anja",
    members: ["Robin", "Anja"],
    groceryPortions: 2,
    householdPortions: 2
  },
  jimmy: {
    label: "Jimmy",
    members: ["Jimmy"],
    groceryPortions: 1.5,
    householdPortions: 1
  }
};
const ROB_GROUP = "robinAnja";
const STORAGE_KEY = "family-grocery-expenses-v1";

const state = {
  mode: "grocery",
  expenses: loadExpenses()
};

const elements = {
  form: document.querySelector("#expenseForm"),
  payer: document.querySelector("#payer"),
  store: document.querySelector("#store"),
  date: document.querySelector("#date"),
  total: document.querySelector("#total"),
  includeJimmy: document.querySelector("#includeJimmy"),
  jimmySplitRow: document.querySelector("#jimmySplitRow"),
  ocrText: document.querySelector("#ocrText"),
  receiptFile: document.querySelector("#receiptFile"),
  runOcrButton: document.querySelector("#runOcrButton"),
  parseTextButton: document.querySelector("#parseTextButton"),
  clearDataButton: document.querySelector("#clearDataButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  ocrStatus: document.querySelector("#ocrStatus"),
  ocrArea: document.querySelector("#ocrArea"),
  ocrNote: document.querySelector("#ocrNote"),
  periodName: document.querySelector("#periodName"),
  periodStart: document.querySelector("#periodStart"),
  periodEnd: document.querySelector("#periodEnd"),
  paymentDue: document.querySelector("#paymentDue"),
  periodGrid: document.querySelector("#periodGrid"),
  modeTabs: document.querySelectorAll(".mode-tab"),
  totalsGrid: document.querySelector("#totalsGrid"),
  expensesTable: document.querySelector("#expensesTable"),
  splitNote: document.querySelector("#splitNote")
};

elements.date.valueAsDate = new Date();
setDefaultPeriod();

elements.modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

elements.runOcrButton.addEventListener("click", runOcr);
elements.parseTextButton.addEventListener("click", () => applyParsedText(elements.ocrText.value));
elements.clearDataButton.addEventListener("click", clearData);
elements.exportCsvButton.addEventListener("click", exportCsv);
[elements.periodName, elements.periodStart, elements.periodEnd, elements.paymentDue].forEach((input) => {
  input.addEventListener("input", render);
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const total = Number.parseFloat(elements.total.value);

  if (!Number.isFinite(total) || total <= 0) {
    setStatus("Enter a total greater than zero.", true);
    elements.total.focus();
    return;
  }

  state.expenses.unshift({
    id: crypto.randomUUID(),
    type: state.mode,
    payer: elements.payer.value,
    store: elements.store.value.trim(),
    date: elements.date.value,
    total,
    includeJimmy: state.mode === "grocery" ? elements.includeJimmy.checked : true,
    rawText: elements.ocrText.value.trim(),
    createdAt: new Date().toISOString()
  });

  saveExpenses();
  resetForm();
  render();
});

function setMode(mode) {
  state.mode = mode;
  elements.modeTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  elements.ocrArea.style.display = mode === "grocery" ? "grid" : "none";
  elements.ocrNote.style.display = mode === "grocery" ? "block" : "none";
  elements.ocrText.closest("label").style.display = mode === "grocery" ? "grid" : "none";
  elements.jimmySplitRow.style.display = mode === "grocery" ? "flex" : "none";
  elements.store.placeholder = mode === "grocery" ? "Checkers, Pick n Pay, Woolworths..." : "Electricity, water, internet...";
}

async function runOcr() {
  const file = elements.receiptFile.files[0];

  if (!file) {
    setStatus("Choose a slip image first.", true);
    return;
  }

  if (!window.Tesseract) {
    setStatus("OCR library could not load. Check the internet connection, or paste slip text and use Parse text.", true);
    return;
  }

  try {
    elements.runOcrButton.disabled = true;
    setStatus("Reading slip...");
    const result = await Tesseract.recognize(file, "eng", {
      logger: ({ status, progress }) => {
        if (progress) {
          setStatus(`${sentenceCase(status)} ${Math.round(progress * 100)}%`);
        } else {
          setStatus(sentenceCase(status));
        }
      }
    });
    elements.ocrText.value = result.data.text.trim();
    applyParsedText(result.data.text);
    setStatus("OCR complete. Check the extracted fields before saving.");
  } catch (error) {
    setStatus(`OCR failed: ${error.message}`, true);
  } finally {
    elements.runOcrButton.disabled = false;
  }
}

function applyParsedText(text) {
  const parsed = parseReceiptText(text);

  if (parsed.store && !elements.store.value.trim()) {
    elements.store.value = parsed.store;
  }
  if (parsed.date) {
    elements.date.value = parsed.date;
  }
  if (parsed.total) {
    elements.total.value = parsed.total.toFixed(2);
  }

  setStatus("Text parsed. Please check the store and total before saving.");
}

function parseReceiptText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const store = findStore(lines);
  const date = findDate(lines);
  const total = findTotal(lines);

  return { store, date, total };
}

function findStore(lines) {
  const ignored = /^(tax|vat|tel|phone|date|time|cashier|invoice|receipt|subtotal|total|change|card|approved)/i;
  const candidate = lines.find((line) => /[a-z]/i.test(line) && !ignored.test(line) && !moneyAtEnd(line));
  return candidate ? titleCase(candidate.slice(0, 48)) : "";
}

function findDate(lines) {
  const patterns = [
    /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;

      if (match[1].length === 4) {
        return toDateInput(match[1], match[2], match[3]);
      }

      const year = match[3].length === 2 ? `20${match[3]}` : match[3];
      return toDateInput(year, match[2], match[1]);
    }
  }

  return "";
}

function findTotal(lines) {
  const totalLines = lines.filter((line) => /(grand\s*)?total|amount due|balance due|sale/i.test(line));
  const totals = totalLines.flatMap(extractAmounts);

  if (totals.length) {
    return Math.max(...totals);
  }

  const allAmounts = lines.flatMap(extractAmounts);
  return allAmounts.length ? Math.max(...allAmounts) : 0;
}

function extractAmounts(line) {
  return Array.from(line.matchAll(/(?:r\s*)?(\d{1,5}(?:[ ,]\d{3})*[.,]\d{2})\b/ig))
    .map((match) => Number.parseFloat(match[1].replace(/[ ,]/g, "").replace(",", ".")))
    .filter(Number.isFinite);
}

function moneyAtEnd(line) {
  return /(?:r\s*)?\d+[.,]\d{2}\s*$/i.test(line);
}

function calculateGroupTotals(expenses = periodExpenses()) {
  const totals = Object.fromEntries(Object.keys(GROUPS).map((key) => [key, {
    paid: 0,
    portion: 0
  }]));

  for (const expense of expenses) {
    const payerGroup = groupForPerson(expense.payer);
    const split = splitForExpense(expense);

    for (const groupKey of Object.keys(GROUPS)) {
      totals[groupKey].portion += expense.total * (split.portions[groupKey] / split.totalPortions);
    }

    totals[payerGroup].paid += expense.total;
  }

  return totals;
}

function calculateSettlements() {
  const totals = calculateGroupTotals();

  return [
    settlementCard("dadMom", "Pay to Rob", totals),
    settlementCard("jimmy", "Pay to Rob", totals),
    settlementCard(ROB_GROUP, "Contribution", totals)
  ];
}

function settlementCard(groupKey, note, totals) {
  const group = GROUPS[groupKey];
  const contribution = totals[groupKey].paid;
  const portion = totals[groupKey].portion;
  const amount = groupKey === ROB_GROUP ? portion : Math.max(0, portion - contribution);

  return {
    groupKey,
    label: group.label,
    amount,
    note,
    detail: groupKey === ROB_GROUP
      ? `Portion ${formatMoney(portion)} | Paid ${formatMoney(contribution)}`
      : `Portion ${formatMoney(portion)} | Paid ${formatMoney(contribution)}`
  };
}

function groupForPerson(person) {
  const entry = Object.entries(GROUPS).find(([, group]) => group.members.includes(person));
  return entry ? entry[0] : ROB_GROUP;
}

function render() {
  renderTotals();
  renderPeriodDashboard();
  renderExpenses();
}

function renderTotals() {
  const settlements = calculateSettlements();

  elements.totalsGrid.innerHTML = settlements
    .map((settlement) => `
      <div class="total-card">
        <small>${settlement.label}</small>
        <strong>${formatMoney(settlement.amount)}</strong>
        <span>${settlement.note}</span>
        <em>${settlement.detail}</em>
      </div>
    `)
    .join("");

  elements.splitNote.textContent = "Groceries split by 5.5 portions when Jimmy is included: Dad/Mom 2, Robin & Anja 2, Jimmy 1.5. If Jimmy is excluded for a grocery slip, it splits by 4 portions: Dad/Mom 2, Robin & Anja 2, Jimmy 0. Household costs always split by 5 portions: Dad/Mom 2, Robin & Anja 2, Jimmy 1.";
}

function renderPeriodDashboard() {
  const expenses = periodExpenses();
  const groceryTotal = sumByType(expenses, "grocery");
  const householdTotal = sumByType(expenses, "household");
  const settlements = calculateSettlements();
  const totalPayable = settlements
    .filter((settlement) => settlement.groupKey !== ROB_GROUP)
    .reduce((sum, settlement) => sum + settlement.amount, 0);

  elements.periodGrid.innerHTML = `
    <div class="metric-card">
      <small>Period</small>
      <strong>${escapeHtml(elements.periodName.value || "Billing period")}</strong>
    </div>
    <div class="metric-card">
      <small>Start date</small>
      <strong>${formatDisplayDate(elements.periodStart.value)}</strong>
    </div>
    <div class="metric-card">
      <small>End date</small>
      <strong>${formatDisplayDate(elements.periodEnd.value)}</strong>
    </div>
    <div class="metric-card">
      <small>Payment due date</small>
      <strong>${formatDisplayDate(elements.paymentDue.value)}</strong>
    </div>
    <div class="metric-card">
      <small>Grocery total for this period</small>
      <strong>${formatMoney(groceryTotal)}</strong>
    </div>
    <div class="metric-card">
      <small>Household total for this period</small>
      <strong>${formatMoney(householdTotal)}</strong>
    </div>
    <div class="metric-card">
      <small>Total payable to Rob</small>
      <strong>${formatMoney(totalPayable)}</strong>
    </div>
  `;
}

function renderExpenses() {
  if (!state.expenses.length) {
    elements.expensesTable.innerHTML = `<tr><td class="empty-state" colspan="7">No expenses saved yet.</td></tr>`;
    return;
  }

  elements.expensesTable.innerHTML = state.expenses
    .map((expense) => `
      <tr>
        <td>${escapeHtml(expense.date)}</td>
        <td><span class="pill">${escapeHtml(expense.type)}</span></td>
        <td>${escapeHtml(expense.store)}</td>
        <td>${escapeHtml(expense.payer)}</td>
        <td>${jimmySplitLabel(expense)}</td>
        <td>${formatMoney(expense.total)}</td>
        <td><button class="danger-button" type="button" data-delete="${expense.id}">Delete</button></td>
      </tr>
    `)
    .join("");

  elements.expensesTable.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.expenses = state.expenses.filter((expense) => expense.id !== button.dataset.delete);
      saveExpenses();
      render();
    });
  });
}

function exportCsv() {
  const rows = [
    ["Period name", "Period start", "Period end", "Payment due", "Date", "Type", "Store or description", "Paid by", "Include Jimmy in grocery split", "Total", "Dad/Mom portion", "Robin & Anja portion", "Jimmy portion"]
  ];

  for (const expense of state.expenses) {
    rows.push([
      elements.periodName.value,
      elements.periodStart.value,
      elements.periodEnd.value,
      elements.paymentDue.value,
      expense.date,
      expense.type,
      expense.store,
      expense.payer,
      expense.type === "grocery" ? (includesJimmy(expense) ? "Yes" : "No") : "Household unaffected",
      expense.total.toFixed(2),
      groupPortion(expense, "dadMom").toFixed(2),
      groupPortion(expense, ROB_GROUP).toFixed(2),
      groupPortion(expense, "jimmy").toFixed(2)
    ]);
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `family-grocery-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function clearData() {
  if (!state.expenses.length) return;
  if (!confirm("Clear all saved expenses?")) return;
  state.expenses = [];
  saveExpenses();
  render();
}

function resetForm() {
  const payer = elements.payer.value;
  elements.form.reset();
  elements.payer.value = payer;
  elements.date.valueAsDate = new Date();
  elements.includeJimmy.checked = true;
  setStatus("Expense saved.");
}

function setStatus(message, isError = false) {
  elements.ocrStatus.textContent = message;
  elements.ocrStatus.style.color = isError ? "#9f3a45" : "#315f8f";
}

function saveExpenses() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.expenses));
}

function loadExpenses() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function sumByType(expenses, type) {
  return expenses
    .filter((expense) => expense.type === type)
    .reduce((sum, expense) => sum + Number(expense.total || 0), 0);
}

function groupPortion(expense, groupKey) {
  const split = splitForExpense(expense);
  return expense.total * (split.portions[groupKey] / split.totalPortions);
}

function splitForExpense(expense) {
  if (expense.type === "grocery" && !includesJimmy(expense)) {
    return {
      totalPortions: 4,
      portions: {
        dadMom: 2,
        robinAnja: 2,
        jimmy: 0
      }
    };
  }

  if (expense.type === "grocery") {
    return {
      totalPortions: 5.5,
      portions: {
        dadMom: GROUPS.dadMom.groceryPortions,
        robinAnja: GROUPS.robinAnja.groceryPortions,
        jimmy: GROUPS.jimmy.groceryPortions
      }
    };
  }

  return {
    totalPortions: 5,
    portions: {
      dadMom: GROUPS.dadMom.householdPortions,
      robinAnja: GROUPS.robinAnja.householdPortions,
      jimmy: GROUPS.jimmy.householdPortions
    }
  };
}

function includesJimmy(expense) {
  return expense.type !== "grocery" || expense.includeJimmy !== false;
}

function jimmySplitLabel(expense) {
  if (expense.type !== "grocery") return "Household share";
  return includesJimmy(expense) ? "Yes" : "No";
}

function periodExpenses() {
  const start = elements.periodStart.value;
  const end = elements.periodEnd.value;

  if (!start || !end) return [];

  return state.expenses.filter((expense) => expense.date >= start && expense.date <= end);
}

function setDefaultPeriod() {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonthIndex = today.getMonth();
  const start = new Date(currentYear, currentMonthIndex - 1, 20);
  const end = new Date(currentYear, currentMonthIndex, 18);
  const due = new Date(currentYear, currentMonthIndex, 19);

  elements.periodName.value = `${monthName(start)} / ${monthName(end)} period`;
  elements.periodStart.value = dateInputValue(start);
  elements.periodEnd.value = dateInputValue(end);
  elements.paymentDue.value = dateInputValue(due);
}

function dateInputValue(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthName(date) {
  return date.toLocaleDateString("en-ZA", { month: "long" });
}

function formatDisplayDate(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function toDateInput(year, month, day) {
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR"
  }).format(value);
}

function titleCase(value) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function sentenceCase(value = "") {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

setMode("grocery");
render();
