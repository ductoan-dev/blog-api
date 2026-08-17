require("module-alias/register");
require("dotenv").config();

const bcrypt = require("bcrypt");
const slugify = require("slugify");
const { faker } = require("@faker-js/faker");
const prisma = require("@/db/prisma");

const TOPICS = [
  { name: "Technology", slug: "technology" },
  { name: "Lifestyle", slug: "lifestyle" },
  { name: "Programming", slug: "programming" },
  { name: "Design", slug: "design" },
  { name: "Career", slug: "career" },
];

const thumbUrl = (i) => `uploads/thumbnails/${(i % 10) + 1}.svg`;

const TAGS = ["javascript", "nodejs", "react", "postgresql", "css", "ux", "tips", "tools"];

const POST_TITLES = [
  "Getting Started with PostgreSQL and Prisma",
  "10 JavaScript Tips You Probably Didn't Know",
  "Building a REST API with Express and Node.js",
  "How to Design a Clean UI from Scratch",
  "My Journey from Junior to Senior Developer",
  "React Hooks: A Complete Guide for Beginners",
  "Why I Switched from MongoDB to PostgreSQL",
  "CSS Grid vs Flexbox: When to Use Which",
  "How I Manage My Time as a Freelance Developer",
  "Understanding Async/Await in JavaScript",
  "5 VS Code Extensions That Changed My Workflow",
  "The Art of Writing Clean Code",
  "Setting Up CI/CD for Your Node.js App",
  "Lessons Learned After 3 Years of Full-Stack Dev",
  "Prisma Migrations: A Practical Guide",
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
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.queue.deleteMany();
  await prisma.bookmark.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.like.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.userSetting.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.topic.deleteMany();
  await prisma.user.deleteMany();
  console.log("Cleared all tables");

  const passwordHash = await bcrypt.hash("123456", 10);

  const users = await Promise.all([
    prisma.user.create({
      data: {
        firstName: "Alice", lastName: "Nguyen", email: "alice@example.com",
        username: "alice", fullname: "Alice Nguyen", password: passwordHash,
        avatar: `https://i.pravatar.cc/150?u=alice`, verifiedAt: new Date(),
        title: "Full-Stack Developer", about: faker.lorem.sentences(2),
      },
    }),
    prisma.user.create({
      data: {
        firstName: "Bob", lastName: "Tran", email: "bob@example.com",
        username: "bob", fullname: "Bob Tran", password: passwordHash,
        avatar: `https://i.pravatar.cc/150?u=bob`, verifiedAt: new Date(),
        title: "UI/UX Designer", about: faker.lorem.sentences(2),
      },
    }),
    prisma.user.create({
      data: {
        firstName: "Carol", lastName: "Le", email: "carol@example.com",
        username: "carol", fullname: "Carol Le", password: passwordHash,
        avatar: `https://i.pravatar.cc/150?u=carol`, verifiedAt: new Date(),
        title: "Backend Engineer", about: faker.lorem.sentences(2),
      },
    }),
  ]);
  console.log(`Created ${users.length} users`);

  const topics = await Promise.all(
    TOPICS.map((t, i) =>
      prisma.topic.create({
        data: { ...t, image: thumbUrl(i), description: faker.lorem.sentence(), postsCount: 0 },
      })
    )
  );
  console.log(`Created ${topics.length} topics`);

  const tags = await Promise.all(TAGS.map((name) => prisma.tag.create({ data: { name } })));
  console.log(`Created ${tags.length} tags`);

  const usedSlugs = new Set();
  const posts = [];
  for (let i = 0; i < POST_TITLES.length; i++) {
    const title = POST_TITLES[i];
    let slug = makeSlug(title, 0);
    let counter = 1;
    while (usedSlugs.has(slug)) slug = makeSlug(title, counter++);
    usedSlugs.add(slug);

    const author = users[i % users.length];
    const postTopics = faker.helpers.arrayElements(topics, faker.number.int({ min: 1, max: 2 }));
    const postTags = faker.helpers.arrayElements(tags, faker.number.int({ min: 1, max: 3 }));

    const post = await prisma.post.create({
      data: {
        userId: author.id,
        title,
        slug,
        description: faker.lorem.sentences(2),
        content: makeContent(title),
        thumbnail: thumbUrl(i),
        status: "published",
        visibility: "public",
        publishedAt: faker.date.recent({ days: 30 }),
        viewsCount: faker.number.int({ min: 50, max: 2000 }),
        likesCount: 0,
        topics: { connect: postTopics.map((t) => ({ id: t.id })) },
        tags: { connect: postTags.map((t) => ({ id: t.id })) },
      },
    });
    posts.push(post);
  }
  console.log(`Created ${posts.length} posts`);

  for (const user of users) {
    const count = posts.filter((p) => p.userId === user.id).length;
    await prisma.user.update({ where: { id: user.id }, data: { postsCount: count } });
  }
  for (const topic of topics) {
    const count = await prisma.post.count({ where: { topics: { some: { id: topic.id } } } });
    await prisma.topic.update({ where: { id: topic.id }, data: { postsCount: count } });
  }

  const comments = [];
  for (const post of posts.slice(0, 8)) {
    const commenters = faker.helpers.arrayElements(users, faker.number.int({ min: 1, max: 3 }));
    for (const commenter of commenters) {
      const comment = await prisma.comment.create({
        data: {
          userId: commenter.id,
          postId: post.id,
          content: faker.lorem.sentences(faker.number.int({ min: 1, max: 3 })),
          likeCount: faker.number.int({ min: 0, max: 10 }),
        },
      });
      comments.push(comment);
    }
  }
  console.log(`Created ${comments.length} comments`);

  let replyCount = 0;
  for (const comment of comments.slice(0, 5)) {
    const replier = users[faker.number.int({ min: 0, max: users.length - 1 })];
    await prisma.comment.create({
      data: {
        userId: replier.id,
        postId: comment.postId,
        parentId: comment.id,
        content: faker.lorem.sentence(),
      },
    });
    replyCount += 1;
  }
  console.log(`Created ${replyCount} replies`);

  let likeCount = 0;
  for (const post of posts) {
    const likers = faker.helpers.arrayElements(users, faker.number.int({ min: 0, max: users.length }));
    for (const liker of likers) {
      await prisma.like.create({
        data: { userId: liker.id, likeableType: "Post", likeableId: post.id },
      }).catch(() => {});
      likeCount += 1;
    }
    await prisma.post.update({
      where: { id: post.id },
      data: { likesCount: likers.length },
    });
    await prisma.user.update({
      where: { id: post.userId },
      data: { likesCount: { increment: likers.length } },
    });
  }
  console.log(`Created ${likeCount} likes`);

  for (const user of users) {
    const saved = faker.helpers.arrayElements(posts, faker.number.int({ min: 1, max: 4 }));
    for (const post of saved) {
      await prisma.bookmark.create({ data: { userId: user.id, postId: post.id } }).catch(() => {});
    }
  }
  console.log("Created bookmarks");

  await prisma.follow.create({ data: { followerId: users[0].id, followingId: users[1].id } });
  await prisma.follow.create({ data: { followerId: users[1].id, followingId: users[2].id } });
  await prisma.follow.create({ data: { followerId: users[2].id, followingId: users[0].id } });
  for (const user of users) {
    await prisma.user.update({ where: { id: user.id }, data: { followingCount: 1, followerCount: 1 } });
  }
  console.log("Created follows");

  const conv = await prisma.conversation.create({
    data: {
      name: "Alice & Bob",
      createdBy: users[0].id,
      lastMessageAt: new Date(),
      members: { connect: [{ id: users[0].id }, { id: users[1].id }] },
    },
  });
  await prisma.message.create({ data: { userId: users[0].id, conversationId: conv.id, content: "Hey, check out my new post!" } });
  await prisma.message.create({ data: { userId: users[1].id, conversationId: conv.id, content: "Looks great, very well written!" } });
  await prisma.message.create({ data: { userId: users[0].id, conversationId: conv.id, content: "Thanks! Working on part 2 now." } });
  console.log("Created conversation & messages");

  console.log("\n✅ Seed xong!");
  console.log("─────────────────────────────");
  console.log(`👤 Users   : ${users.length} (password: 123456)`);
  console.log(`📝 Posts   : ${posts.length}`);
  console.log(`💬 Comments: ${comments.length + replyCount}`);
  console.log(`❤️  Likes   : ${likeCount}`);
  console.log(`🏷  Topics  : ${topics.length}`);
  console.log(`🔖 Tags    : ${tags.length}`);
  console.log("─────────────────────────────");
  users.forEach((u) => console.log(`  ${u.email}  /  123456`));

  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
