// Browser-local persistence. Schema upgrade is isolated from the legacy v13 journal localStorage key.
// All data stays on this browser profile until explicit export; there is no cloud sync.
const DB_NAME = "trader-dash-chart-studio";
const VERSION = 1;
const STORES = ["datasets", "annotations", "snapshots", "settings"];
let dbPromise;

function db() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available in this browser."));
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Unable to open the chart journal"));
  }).catch(error => { dbPromise = undefined; throw error; });
  return dbPromise;
}

async function transaction(store, mode, run) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const request = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error || new Error("Database transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("Database transaction aborted"));
    if (request) request.onerror = () => reject(request.error || new Error("Database request failed"));
  });
}

export const getChartRecord = (store, id) => transaction(store,"readonly",s => s.get(id));
export const listChartRecords = (store) => transaction(store,"readonly",s => s.getAll());
export const putChartRecord = (store, record) => transaction(store,"readwrite",s => s.put(record));
export const removeChartRecord = (store,id) => transaction(store,"readwrite",s => s.delete(id));

export async function exportChartArchive() {
  const payload = { schema: 1, exportedAt: new Date().toISOString(), datasets: await listChartRecords("datasets"),
    annotations: await listChartRecords("annotations"), snapshots: await listChartRecords("snapshots") };
  return JSON.stringify(payload, null, 2);
}
