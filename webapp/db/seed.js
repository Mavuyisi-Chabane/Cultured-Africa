const bcrypt = require('bcryptjs');
const { startOfWeek, toSqlDateTime } = require('../utils/dates');

const FILMS = [
  {
    title: 'Echoes of the Highveld',
    culture: 'Zulu',
    genre: 'Drama',
    price: 50,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_52e9c93fef_da0216cd05c3851f.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_52e9c93fef_da0216cd05c3851f.png',
    description: 'A cinematic journey through the Drakensberg mountains, exploring Zulu heritage against a golden-hour backdrop.'
  },
  {
    title: 'Ubuntu: The Eternal Bond',
    culture: 'Xhosa',
    genre: 'Family',
    price: 0,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_a24394bf40_de7dce071e6c3d07.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_a24394bf40_de7dce071e6c3d07.png',
    description: 'A vibrant Xhosa family gathering that celebrates the spirit of Ubuntu and the bonds that hold communities together.'
  },
  {
    title: 'Threads of Venda',
    culture: 'Venda',
    genre: 'Documentary',
    price: 50,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_c9913416c9_85321eb739a38c46.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_c9913416c9_85321eb739a38c46.png',
    description: 'A documentary exploring ancient Venda sculpture and the mystical craftsmanship passed down through generations.'
  },
  {
    title: 'Mountain Guardians',
    culture: 'Sotho',
    genre: 'Action',
    price: 0,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_963875f76b_e13fc2fab352d735.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_963875f76b_e13fc2fab352d735.png',
    description: 'A Basotho horseman defends the mountain passes of Lesotho in this action-driven tale of duty and honour.'
  },
  {
    title: 'The Rhythm of Tsonga',
    culture: 'Tsonga',
    genre: 'Music',
    price: 50,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_56449c7d4b_a4044c492b407804.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_56449c7d4b_a4044c492b407804.png',
    description: 'A vibrant celebration of Tsonga dance and music captured in a cultural festival full of colour and motion.'
  },
  {
    title: 'City of Gold',
    culture: 'Multi-Culture',
    genre: 'Urban Drama',
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
  const filmCount = db.prepare('SELECT COUNT(*) AS n FROM films').get().n;
  if (filmCount > 0) return;

  const insertUser = db.prepare(`
    INSERT INTO users (full_name, email, password_hash, role, avatar, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertFilm = db.prepare(`
    INSERT INTO films (title, culture, genre, price, rating, video_url, thumbnail_url, trailer_url, description, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPurchase = db.prepare(`
    INSERT INTO purchases (user_id, film_id, price, paystack_reference, purchased_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertReview = db.prepare(`
    INSERT INTO reviews (film_id, user_id, rating, comment, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertView = db.prepare(`
    INSERT INTO film_views (film_id, user_id, completion_pct, viewed_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertActivity = db.prepare(`
    INSERT INTO activity_log (type, entity, created_at)
    VALUES (?, ?, ?)
  `);

  const now = new Date();

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
    'Thabo Mokoena', 'member@culturedafrica.co.za', bcrypt.hashSync('member123', 10), 'member',
    'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-4.jpg',
    toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * 24 * 45))
  ).lastInsertRowid;

  const viewerIds = [memberId];
  DEMO_VIEWERS.forEach((v, i) => {
    const id = insertUser.run(
      v.fullName, v.email, bcrypt.hashSync('demo1234', 10), 'member',
      `https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-${(i % 4) + 1}.jpg`,
      toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * 24 * (40 - i * 5)))
    ).lastInsertRowid;
    viewerIds.push(id);
  });

  const filmIds = FILMS.map((f, i) => {
    const uploadedAt = toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * (24 * (28 - i * 3) + 2)));
    const id = insertFilm.run(
      f.title, f.culture, f.genre, f.price, 0,
      f.videoUrl, f.thumbnailUrl, '', f.description, uploadedAt
    ).lastInsertRowid;
    insertActivity.run('Film uploaded', f.title, uploadedAt);
    return id;
  });

  insertActivity.run('New user registered', 'Thabo Mokoena', toSqlDateTime(new Date(now.getTime() - 1000 * 60 * 60 * 24 * 45)));

  // Four weeks of synthetic purchases, views and reviews so reports have real data to show immediately.
  const week0Start = startOfWeek(now);
  for (let weekAgo = 3; weekAgo >= 0; weekAgo--) {
    const weekStart = new Date(week0Start.getTime() - weekAgo * 7 * 24 * 60 * 60 * 1000);

    FILMS.forEach((f, filmIdx) => {
      const filmId = filmIds[filmIdx];
      const isFree = f.price === 0;

      const viewCount = isFree ? randInt(15, 40) : randInt(4, 18);
      for (let i = 0; i < viewCount; i++) {
        const viewedAt = new Date(weekStart.getTime() + randInt(0, 6 * 24 * 60 * 60 * 1000) + randInt(0, 86400000));
        if (viewedAt > now) continue;
        const completion = isFree ? randInt(55, 100) : randInt(35, 100);
        insertView.run(filmId, pick(viewerIds), completion, toSqlDateTime(viewedAt));
      }

      if (!isFree) {
        const purchaseCount = randInt(2, 12);
        for (let i = 0; i < purchaseCount; i++) {
          const purchasedAt = new Date(weekStart.getTime() + randInt(0, 6 * 24 * 60 * 60 * 1000) + randInt(0, 86400000));
          if (purchasedAt > now) continue;
          const buyerId = pick(viewerIds);
          const ref = `SEED-${filmId}-${weekAgo}-${i}`;
          insertPurchase.run(buyerId, filmId, f.price, ref, toSqlDateTime(purchasedAt));
          insertActivity.run('Purchase made', f.title, toSqlDateTime(purchasedAt));
        }
      }

      if (Math.random() < 0.6) {
        const reviewCount = randInt(1, 2);
        for (let i = 0; i < reviewCount; i++) {
          const createdAt = new Date(weekStart.getTime() + randInt(0, 6 * 24 * 60 * 60 * 1000) + randInt(0, 86400000));
          if (createdAt > now) continue;
          insertReview.run(filmId, pick(viewerIds), randInt(3, 5), pick(REVIEW_COMMENTS), toSqlDateTime(createdAt));
          insertActivity.run('Review submitted', f.title, toSqlDateTime(createdAt));
        }
      }
    });
  }

  // Recompute each film's displayed rating from its seeded reviews.
  const updateRating = db.prepare('UPDATE films SET rating = ? WHERE id = ?');
  filmIds.forEach(filmId => {
    const row = db.prepare('SELECT AVG(rating) AS avg FROM reviews WHERE film_id = ?').get(filmId);
    updateRating.run(row.avg ? Math.round(row.avg * 10) / 10 : 0, filmId);
  });
}

module.exports = { seed };
