const admin = require('firebase-admin');

let _firestore = null;

function getFirestore() {
  if (_firestore) return _firestore;
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  _firestore = admin.firestore();
  return _firestore;
}

const db = {
  async insert(col, record) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const data = { ...record, created_at: now };
    const ref = await getFirestore().collection(col).add(data);
    return { id: ref.id, ...data };
  },

  async filter(col, predicate = () => true) {
    const snap = await getFirestore().collection(col).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(predicate);
  },

  async getById(col, id) {
    const doc = await getFirestore().collection(col).doc(String(id)).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async update(col, id, updates) {
    const ref = getFirestore().collection(col).doc(String(id));
    await ref.update(updates);
    const doc = await ref.get();
    return { id: doc.id, ...doc.data() };
  },

  async delete(col, id) {
    const ref = getFirestore().collection(col).doc(String(id));
    const doc = await ref.get();
    if (!doc.exists) return false;
    await ref.delete();
    return true;
  },

  async count(col) {
    const snap = await getFirestore().collection(col).count().get();
    return snap.data().count;
  },
};

module.exports = db;
