const prisma = require("@/db/prisma");

let counter = 0;

async function createUser(overrides = {}) {
  counter += 1;
  return prisma.user.create({
    data: {
      email: `user${counter}@example.com`,
      username: `user${counter}`,
      firstName: "Test",
      lastName: `User${counter}`,
      password: "hashed-password",
      ...overrides,
    },
  });
}

module.exports = { createUser };
