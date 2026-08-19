const bcrypt = require('bcryptjs');

let nextUserId = 1;
let nextFilmId = 1;
let nextReviewId = 1;

const users = [
  {
    id: nextUserId++,
    fullName: 'Lesedi Molefe',
    email: 'admin@culturedafrica.co.za',
    passwordHash: bcrypt.hashSync('admin123', 10),
    role: 'admin',
    avatar: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-1.jpg'
  },
  {
    id: nextUserId++,
    fullName: 'NTK Testing',
    email: 'ntk.testing12@gmail.com',
    passwordHash: bcrypt.hashSync('Testing12', 10),
    role: 'admin',
    avatar: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-1.jpg'
  },
  {
    id: nextUserId++,
    fullName: 'Thabo Mokoena',
    email: 'member@culturedafrica.co.za',
    passwordHash: bcrypt.hashSync('member123', 10),
    role: 'member',
    avatar: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/avatars/avatar-4.jpg'
  }
];

const films = [
  {
    id: nextFilmId++,
    title: 'Echoes of the Highveld',
    culture: 'Zulu',
    genre: 'Drama',
    price: 50,
    rating: 4.9,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_52e9c93fef_da0216cd05c3851f.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_52e9c93fef_da0216cd05c3851f.png',
    trailerUrl: '',
    description: 'A cinematic journey through the Drakensberg mountains, exploring Zulu heritage against a golden-hour backdrop.',
    uploadedAt: new Date(Date.now() - 1000 * 60 * 60 * 2)
  },
  {
    id: nextFilmId++,
    title: 'Ubuntu: The Eternal Bond',
    culture: 'Xhosa',
    genre: 'Family',
    price: 0,
    rating: 4.7,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_a24394bf40_de7dce071e6c3d07.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_a24394bf40_de7dce071e6c3d07.png',
    trailerUrl: '',
    description: 'A vibrant Xhosa family gathering that celebrates the spirit of Ubuntu and the bonds that hold communities together.',
    uploadedAt: new Date(Date.now() - 1000 * 60 * 60 * 5)
  },
  {
    id: nextFilmId++,
    title: 'Threads of Venda',
    culture: 'Venda',
    genre: 'Documentary',
    price: 50,
    rating: 5.0,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_c9913416c9_85321eb739a38c46.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_c9913416c9_85321eb739a38c46.png',
    trailerUrl: '',
    description: 'A documentary exploring ancient Venda sculpture and the mystical craftsmanship passed down through generations.',
    uploadedAt: new Date(Date.now() - 1000 * 60 * 60 * 24)
  },
  {
    id: nextFilmId++,
    title: 'Mountain Guardians',
    culture: 'Sotho',
    genre: 'Action',
    price: 0,
    rating: 4.2,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_963875f76b_e13fc2fab352d735.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_963875f76b_e13fc2fab352d735.png',
    trailerUrl: '',
    description: 'A Basotho horseman defends the mountain passes of Lesotho in this action-driven tale of duty and honour.',
    uploadedAt: new Date(Date.now() - 1000 * 60 * 60 * 30)
  },
  {
    id: nextFilmId++,
    title: 'The Rhythm of Tsonga',
    culture: 'Tsonga',
    genre: 'Music',
    price: 50,
    rating: 4.8,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_56449c7d4b_a4044c492b407804.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_56449c7d4b_a4044c492b407804.png',
    trailerUrl: '',
    description: 'A vibrant celebration of Tsonga dance and music captured in a cultural festival full of colour and motion.',
    uploadedAt: new Date(Date.now() - 1000 * 60 * 60 * 40)
  },
  {
    id: nextFilmId++,
    title: 'City of Gold',
    culture: 'Multi-Culture',
    genre: 'Urban Drama',
    price: 0,
    rating: 4.6,
    thumbnailUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_7dc1ce2205_a1cbb076ce11651c.png',
    videoUrl: 'https://storage.googleapis.com/uxpilot-auth.appspot.com/gen_7dc1ce2205_a1cbb076ce11651c.png',
    trailerUrl: '',
    description: 'An urban drama set against the Johannesburg skyline, weaving together stories from across South Africa’s cultures.',
    uploadedAt: new Date(Date.now() - 1000 * 60 * 60 * 50)
  }
];

const purchases = [];

const reviews = [
  {
    id: nextReviewId++,
    filmId: films[4].id,
    userId: users[1].id,
    rating: 5,
    comment: 'Absolutely loved the energy of this film!',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
    adminReply: null
  }
];

const activityLog = [
  { type: 'Film uploaded', entity: 'Echoes of the Highveld', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2) },
  { type: 'New user registered', entity: 'Thabo Mokoena', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5) },
  { type: 'Review submitted', entity: 'The Rhythm of Tsonga', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48) }
];

function logActivity(type, entity) {
  activityLog.unshift({ type, entity, timestamp: new Date() });
}

module.exports = {
  users,
  films,
  purchases,
  reviews,
  activityLog,
  logActivity,
  nextIds: {
    nextUserId: () => nextUserId++,
    nextFilmId: () => nextFilmId++,
    nextReviewId: () => nextReviewId++
  }
};
