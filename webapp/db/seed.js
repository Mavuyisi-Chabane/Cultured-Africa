const bcrypt = require('bcryptjs');
const { startOfWeek, toSqlDateTime } = require('../utils/dates');

const CULTURES = [
  { name: 'Zulu', description: 'Stories rooted in Zulu tradition, courtship, and kingship.', region: 'KwaZulu-Natal' },
  { name: 'Xhosa', description: 'Stories of Xhosa family life, ceremony, and community.', region: 'Eastern Cape' },
  { name: 'Venda', description: 'Stories of Venda craft, myth, and ancestral heritage.', region: 'Limpopo' },
  { name: 'Sotho', description: 'Stories of Basotho mountain life and tradition.', region: 'Free State / Lesotho border' },
  { name: 'Tsonga', description: 'Stories of Tsonga music, dance, and festival culture.', region: 'Limpopo / Mpumalanga' },
  { name: 'Multi-Culture', description: 'Stories that weave together multiple South African cultures.', region: 'National' }
];

const FILMS = [
  {
    title: 'Echoes of the Highveld',
    culture: 'Zulu',
    contentType: 'Drama',
    price: 50,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_52e9c93fef_da0216cd05c3851f.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_52e9c93fef_da0216cd05c3851f.png',
    description: 'A cinematic journey through the Drakensberg mountains, exploring Zulu heritage against a golden-hour backdrop.'
  },
  {
    title: 'Ubuntu: The Eternal Bond',
    culture: 'Xhosa',
    contentType: 'Family',
    price: 0,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_a24394bf40_de7dce071e6c3d07.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_a24394bf40_de7dce071e6c3d07.png',
    description: 'A vibrant Xhosa family gathering that celebrates the spirit of Ubuntu and the bonds that hold communities together.'
  },
  {
    title: 'Threads of Venda',
    culture: 'Venda',
    contentType: 'Documentary',
    price: 50,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_c9913416c9_85321eb739a38c46.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_c9913416c9_85321eb739a38c46.png',
    description: 'A documentary exploring ancient Venda sculpture and the mystical craftsmanship passed down through generations.'
  },
  {
    title: 'Mountain Guardians',
    culture: 'Sotho',
    contentType: 'Action',
    price: 0,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_963875f76b_e13fc2fab352d735.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_963875f76b_e13fc2fab352d735.png',
    description: 'A Basotho horseman defends the mountain passes of Lesotho in this action-driven tale of duty and honour.'
  },
  {
    title: 'The Rhythm of Tsonga',
    culture: 'Tsonga',
    contentType: 'Music',
    price: 50,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_56449c7d4b_a4044c492b407804.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_56449c7d4b_a4044c492b407804.png',
    description: 'A vibrant celebration of Tsonga dance and music captured in a cultural festival full of colour and motion.'
  },
  {
    title: 'City of Gold',
    culture: 'Multi-Culture',
    contentType: 'Urban Drama',
    price: 0,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_7dc1ce2205_a1cbb076ce11651c.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_7dc1ce2205_a1cbb076ce11651c.png',
    description: 'An urban drama set against the Johannesburg skyline, weaving together stories from across South Africa’s cultures.'
  }
];

const DEMO_VIEWERS = [
  { fullName: 'Thabo Nkosi', email: 'thabo.nkosi@example.com' },
  { fullName: 'Nandi Zulu', email: 'nandi.zulu@example.com' },
  { fullName: 'Malome Sithole', email: 'malome.sithole@example.com' },
  { fullName: 'Amahle Dlamini', email: 'amahle.dlamini@example.com' }
];

const REVIEW_COMMENTS = [
  'Absolutely loved the energy of this film!',
  'Beautifully shot and deeply moving.',
  'This gave me such a strong sense of pride in our culture.',
  'Great storytelling, would watch again.',
  'The music and visuals were stunning.',
  'A must-watch for anyone interested in our heritage.'
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function seed(db) {
  const contentCount = db.prepare('SELECT COUNT(*) AS n FROM content').get().n;
  if (contentCount > 0) return;

  const insertUser = db.prepare(`
    INSERT INTO users (full_name, email, password_hash, is_verified, role, avatar, registration_date)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `);
  const insertCulture = db.prepare(`
    INSERT INTO cultures (name, description, region, banner_image_url) VALUES (?, ?, ?, ?)
  `);
  const insertContent = db.prepare(`
    INSERT INTO content (culture_id, uploaded_by, title, description, content_type, price, file_url, thumbnail_url, trailer_url, upload_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)
  `);
  const insertPurchase = db.prepare(`
    INSERT INTO purchases (user_id, content_id, amount_paid, payment_status, transaction_ref, purchase_date)
    VALUES (?, ?, ?, 'completed', ?, ?)
  `);
  const insertFeedback = db.prepare(`
    INSERT INTO feedback (content_id, user_id, rating, comment, submitted_date)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertWatch = db.prepare(`
    INSERT INTO watch_history (content_id, user_id, progress_seconds, completed, watch_date)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertActivity = db.prepare(`
    INSERT INTO activity_log (type, entity, created_at) VALUES (?, ?, ?)
  `);
  const insertNotification = db.prepare(`
    INSERT INTO notifications (user_id, type, message, is_read, sent_date) VALUES (?, ?, ?, ?, ?)
  `);

  const now = new Date();

  const cultureIds = {};
  CULTURES.forEach(c => {
    cultureIds[c.name] = insertCulture.run(c.name, c.description, c.region, '').lastInsertRowid;
  });

  const adminId = insertUser.run(
    'Lesedi Molefe', 'admin@culturedafrica.co.za', bcrypt.hashSync('admin123', 10), 'admin',
    'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-1.jpg',
    toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * 24 * 60))
  ).lastInsertRowid;

  insertUser.run(
    'NTK Testing', 'ntk.testing12@gmail.com', bcrypt.hashSync('Testing12', 10), 'admin',
    'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-1.jpg',
    toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10))
  );

  const memberId = insertUser.run(
    'Thabo Mokoena', 'member@culturedafrica.co.za', bcrypt.hashSync('member123', 10), 'customer',
    'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-4.jpg',
    toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * 24 * 45))
  ).lastInsertRowid;

  const viewerIds = [memberId];
  DEMO_VIEWERS.forEach((v, i) => {
    const id = insertUser.run(
      v.fullName, v.email, bcrypt.hashSync('demo1234', 10), 'customer',
      `https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-${(i % 4) + 1}.jpg`,
      toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * 24 * (40 - i * 5)))
    ).lastInsertRowid;
    viewerIds.push(id);
  });

  const contentIds = FILMS.map((f, i) => {
    const uploadedAt = toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * (24 * (28 - i * 3) + 2)));
    const id = insertContent.run(
      cultureIds[f.culture], adminId, f.title, f.description, f.contentType, f.price,
      f.videoUrl, f.thumbnailUrl, uploadedAt
    ).lastInsertRowid;
    insertActivity.run('Film uploaded', f.title, uploadedAt);
    return id;
  });

  insertActivity.run('New user registered', 'Thabo Mokoena', toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * 24 * 45)));

  // Four weeks of synthetic purchases, watch history and feedback so reports have real data immediately.
  const week0Start = startOfWeek(now);
  for (let weekAgo = 3; weekAgo >= 0; weekAgo--) {
    const weekStart = new Date(week0Start.getTime() - weekAgo * 7 * 24 * 60 * 60 * 1000);

    FILMS.forEach((f, filmIdx) => {
      const contentId = contentIds[filmIdx];
      const isFree = f.price === 0;

      const viewCount = isFree ? randInt(15, 40) : randInt(4, 18);
      for (let i = 0; i < viewCount; i++) {
        const watchedAt = new Date(weekStart.getTime() + randInt(0, 6 * 24 * 60 * 60 * 1000) + randInt(0, 86400000));
        if (watchedAt > now) continue;
        const completedChance = isFree ? 0.65 : 0.55;
        const completed = Math.random() < completedChance;
        const progressSeconds = completed ? randInt(600, 1200) : randInt(30, 600);
        insertWatch.run(contentId, pick(viewerIds), progressSeconds, completed ? 1 : 0, toSqlDateTime(watchedAt));
      }

      if (!isFree) {
        const purchaseCount = randInt(2, 12);
        for (let i = 0; i < purchaseCount; i++) {
          const purchasedAt = new Date(weekStart.getTime() + randInt(0, 6 * 24 * 60 * 60 * 1000) + randInt(0, 86400000));
          if (purchasedAt > now) continue;
          const buyerId = pick(viewerIds);
          const ref = `SEED-${contentId}-${weekAgo}-${i}`;
          insertPurchase.run(buyerId, contentId, f.price, ref, toSqlDateTime(purchasedAt));
          insertActivity.run('Purchase made', f.title, toSqlDateTime(purchasedAt));
          insertNotification.run(buyerId, 'purchase_confirmation', `Your purchase of "${f.title}" was successful.`, 1, toSqlDateTime(purchasedAt));
        }
      }

      if (Math.random() < 0.6) {
        const reviewCount = randInt(1, 2);
        for (let i = 0; i < reviewCount; i++) {
          const submittedAt = new Date(weekStart.getTime() + randInt(0, 6 * 24 * 60 * 60 * 1000) + randInt(0, 86400000));
          if (submittedAt > now) continue;
          insertFeedback.run(contentId, pick(viewerIds), randInt(3, 5), pick(REVIEW_COMMENTS), toSqlDateTime(submittedAt));
          insertActivity.run('Review submitted', f.title, toSqlDateTime(submittedAt));
        }
      }
    });
  }
}

module.exports = { seed };
