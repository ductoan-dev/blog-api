require("module-alias/register");
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const slugify = require("slugify");
const { faker } = require("@faker-js/faker");
const {
  User,
  Post,
  Comment,
  Like,
  Tag,
  Topic,
  Bookmark,
  Follow,
  Conversation,
  Message,
  Notification,
  RefreshToken,
  Queue,
} = require("@/db/models");

const TOPICS = [
  { name: "Technology", slug: "technology" },
  { name: "Lifestyle", slug: "lifestyle" },
  { name: "Programming", slug: "programming" },
  { name: "Design", slug: "design" },
  { name: "Career", slug: "career" },
];

const thumbUrl = (i) => `uploads/thumbnails/${(i % 10) + 1}.svg`;

const TAGS = ["javascript", "nodejs", "react", "mongodb", "css", "ux", "tips", "tools"];

const POST_TITLES = [
  "Getting Started with MongoDB and Mongoose",
  "10 JavaScript Tips You Probably Didn't Know",
  "Building a REST API with Express and Node.js",
  "How to Design a Clean UI from Scratch",
  "My Journey from Junior to Senior Developer",
  "React Hooks: A Complete Guide for Beginners",
  "Why I Switched from MySQL to MongoDB",
  "CSS Grid vs Flexbox: When to Use Which",
  "How I Manage My Time as a Freelance Developer",
  "Understanding Async/Await in JavaScript",
  "5 VS Code Extensions That Changed My Workflow",
  "The Art of Writing Clean Code",
  "Setting Up CI/CD for Your Node.js App",
  "Lessons Learned After 3 Years of Full-Stack Dev",
  "MongoDB Aggregation Pipeline: A Practical Guide",
];

function makeSlug(title, idx) {
  return slugify(title, { lower: true, strict: true }) + (idx > 0 ? `-${idx}` : "");
}

function makeContent(title) {
  const paragraphs = Array.from({ length: faker.number.int({ min: 3, max: 6 }) }, () =>
    `<p>${faker.lorem.paragraph(faker.number.int({ min: 3, max: 7 }))}</p>`
  );
  return `<h1>${title}</h1>\n${paragraphs.join("\n")}`;
}

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  await Promise.all([
    User.deleteMany({}), Post.deleteMany({}), Comment.deleteMany({}),
    Like.deleteMany({}), Tag.deleteMany({}), Topic.deleteMany({}),
    Bookmark.deleteMany({}), Follow.deleteMany({}), Conversation.deleteMany({}),
    Message.deleteMany({}), Notification.deleteMany({}),
    RefreshToken.deleteMany({}), Queue.deleteMany({}),
  ]);
  console.log("Cleared all collections");

  // --- Users ---
  const passwordHash = await bcrypt.hash("123456", 10);

  const users = await User.insertMany([
    {
      first_name: "Alice", last_name: "Nguyen", email: "alice@example.com",
      username: "alice", fullname: "Alice Nguyen", password: passwordHash,
      avatar: `https://i.pravatar.cc/150?u=alice`, verified_at: new Date(),
      title: "Full-Stack Developer", about: faker.lorem.sentences(2),
    },
    {
      first_name: "Bob", last_name: "Tran", email: "bob@example.com",
      username: "bob", fullname: "Bob Tran", password: passwordHash,
      avatar: `https://i.pravatar.cc/150?u=bob`, verified_at: new Date(),
      title: "UI/UX Designer", about: faker.lorem.sentences(2),
    },
    {
      first_name: "Carol", last_name: "Le", email: "carol@example.com",
      username: "carol", fullname: "Carol Le", password: passwordHash,
      avatar: `https://i.pravatar.cc/150?u=carol`, verified_at: new Date(),
      title: "Backend Engineer", about: faker.lorem.sentences(2),
    },
  ]);
  console.log(`Created ${users.length} users`);

  // --- Topics ---
  const topics = await Topic.insertMany(
    TOPICS.map((t, i) => ({ ...t, image: thumbUrl(i), description: faker.lorem.sentence(), posts_count: 0 }))
  );
  console.log(`Created ${topics.length} topics`);

  // --- Tags ---
  const tags = await Tag.insertMany(TAGS.map((name) => ({ name })));
  console.log(`Created ${tags.length} tags`);

  // --- Posts ---
  const usedSlugs = new Set();
  const postsData = POST_TITLES.map((title, i) => {
    let slug = makeSlug(title, 0);
    let counter = 1;
    while (usedSlugs.has(slug)) slug = makeSlug(title, counter++);
    usedSlugs.add(slug);

    const author = users[i % users.length];
    const postTopics = faker.helpers.arrayElements(topics, faker.number.int({ min: 1, max: 2 }));
    const postTags = faker.helpers.arrayElements(tags, faker.number.int({ min: 1, max: 3 }));

    return {
      user_id: author._id,
      title,
      slug,
      description: faker.lorem.sentences(2),
      content: makeContent(title),
      thumbnail: thumbUrl(i),
      status: "published",
      visibility: "public",
      published_at: faker.date.recent({ days: 30 }),
      views_count: faker.number.int({ min: 50, max: 2000 }),
      likes_count: faker.number.int({ min: 0, max: 50 }),
      topics: postTopics.map((t) => t._id),
      tags: postTags.map((t) => t._id),
    };
  });

  const posts = await Post.insertMany(postsData);
  console.log(`Created ${posts.length} posts`);

  // Cập nhật posts_count cho từng user
  for (const user of users) {
    const count = posts.filter((p) => p.user_id.toString() === user._id.toString()).length;
    await User.findByIdAndUpdate(user._id, { posts_count: count });
  }
  // Cập nhật posts_count cho từng topic
  for (const topic of topics) {
    const count = posts.filter((p) =>
      p.topics.some((tid) => tid.toString() === topic._id.toString())
    ).length;
    await Topic.findByIdAndUpdate(topic._id, { posts_count: count });
  }

  // --- Comments ---
  const commentsData = [];
  for (const post of posts.slice(0, 8)) {
    const commenters = faker.helpers.arrayElements(users, faker.number.int({ min: 1, max: 3 }));
    for (const commenter of commenters) {
      commentsData.push({
        user_id: commenter._id,
        post_id: post._id,
        content: faker.lorem.sentences(faker.number.int({ min: 1, max: 3 })),
        like_count: faker.number.int({ min: 0, max: 10 }),
      });
    }
  }
  const comments = await Comment.insertMany(commentsData);
  console.log(`Created ${comments.length} comments`);

  // Một vài replies
  const repliesData = [];
  for (const comment of comments.slice(0, 5)) {
    repliesData.push({
      user_id: users[faker.number.int({ min: 0, max: users.length - 1 })]._id,
      post_id: comment.post_id,
      parent_id: comment._id,
      content: faker.lorem.sentence(),
    });
  }
  await Comment.insertMany(repliesData);
  console.log(`Created ${repliesData.length} replies`);

  // --- Likes ---
  const likesData = [];
  for (const post of posts) {
    const likers = faker.helpers.arrayElements(users, faker.number.int({ min: 0, max: users.length }));
    for (const liker of likers) {
      likesData.push({ user_id: liker._id, likeable_type: "Post", likeable_id: post._id });
    }
  }
  if (likesData.length) await Like.insertMany(likesData, { ordered: false }).catch(() => {});
  console.log(`Created ${likesData.length} likes`);

  // --- Bookmarks ---
  const bookmarksData = [];
  for (const user of users) {
    const saved = faker.helpers.arrayElements(posts, faker.number.int({ min: 1, max: 4 }));
    for (const post of saved) {
      bookmarksData.push({ user_id: user._id, post_id: post._id });
    }
  }
  await Bookmark.insertMany(bookmarksData, { ordered: false }).catch(() => {});
  console.log(`Created bookmarks`);

  // --- Follows ---
  await Follow.create({ follower_id: users[0]._id, following_id: users[1]._id });
  await Follow.create({ follower_id: users[1]._id, following_id: users[2]._id });
  await Follow.create({ follower_id: users[2]._id, following_id: users[0]._id });
  await User.findByIdAndUpdate(users[0]._id, { following_count: 1, follower_count: 1 });
  await User.findByIdAndUpdate(users[1]._id, { following_count: 1, follower_count: 1 });
  await User.findByIdAndUpdate(users[2]._id, { following_count: 1, follower_count: 1 });
  console.log("Created follows");

  // --- Conversation + Messages ---
  const conv = await Conversation.create({
    name: "Alice & Bob", created_by: users[0]._id, members: [users[0]._id, users[1]._id],
    last_message_at: new Date(),
  });
  await Message.insertMany([
    { user_id: users[0]._id, conversation_id: conv._id, content: "Hey, check out my new post!" },
    { user_id: users[1]._id, conversation_id: conv._id, content: "Looks great, very well written!" },
    { user_id: users[0]._id, conversation_id: conv._id, content: "Thanks! Working on part 2 now." },
  ]);
  console.log("Created conversation & messages");

  console.log("\n✅ Seed xong!");
  console.log("─────────────────────────────");
  console.log(`👤 Users   : ${users.length} (password: 123456)`);
  console.log(`📝 Posts   : ${posts.length}`);
  console.log(`💬 Comments: ${comments.length + repliesData.length}`);
  console.log(`❤️  Likes   : ${likesData.length}`);
  console.log(`🏷  Topics  : ${topics.length}`);
  console.log(`🔖 Tags    : ${tags.length}`);
  console.log("─────────────────────────────");
  users.forEach((u) => console.log(`  ${u.email}  /  123456`));

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
