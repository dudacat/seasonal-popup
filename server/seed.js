require('dotenv').config();
const db = require('./db');

async function seedIfEmpty() {
  let POPUPS, RECOMMENDATIONS;
  try {
    const oldData = require('../data/db.json');
    POPUPS = oldData.popups || Object.values(oldData)[0] || oldData;
    RECOMMENDATIONS = oldData.recommendations || [];
  } catch (e) {
    console.log('db.json 파일을 찾을 수 없어 seed를 건너뜁니다.');
    return;
  }

  const count = await db.count('popups');
  if (count > 0) {
    console.log(`Firestore에 이미 팝업 ${count}개가 있습니다. 건너뜁니다.`);
    return;
  }

  console.log(`🌱 db.json에서 팝업 ${POPUPS.length}개를 Firestore로 업로드 중...`);

  for (const popup of POPUPS) {
    const { id, created_at, ...data } = popup;
    if (!Array.isArray(data.media_items)) data.media_items = [];
    await db.insert('popups', data);
    process.stdout.write('.');
  }
  console.log('\n🌱 팝업 업로드 완료');

  if (RECOMMENDATIONS.length > 0) {
    console.log(`🌱 추천 코스 ${RECOMMENDATIONS.length}개 업로드 중...`);
    for (const rec of RECOMMENDATIONS) {
      const { id, created_at, ...data } = rec;
      await db.insert('recommendations', data);
      process.stdout.write('.');
    }
    console.log('\n🌱 추천 코스 업로드 완료');
  }
}

module.exports = seedIfEmpty;

if (require.main === module) {
  seedIfEmpty()
    .then(() => { console.log('완료'); process.exit(0); })
    .catch(err => { console.error('오류:', err.message); process.exit(1); });
}
