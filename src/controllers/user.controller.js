const userService = require("@/service/user.service");
const response = require("../utils/response");

exports.getUserByUsername = async (req, res) => {
  try {
    const result = await userService.getUserByUsername(
      req.params.username,
      req.user
    );
    response.succsess(res, 200, result);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.getFollowersList = async (req, res) => {
  try {
    const result = await userService.getFollowersList(req.params.userId);
    response.succsess(res, 200, result);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.getFollowingList = async (req, res) => {
  try {
    const result = await userService.getFollowingList(req.params.userId);
    response.succsess(res, 200, result);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.toggleFollow = async (req, res) => {
  try {
    const result = await userService.toggleFollow(req.user, req.params.userId);
    response.succsess(res, 200, result);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.checkFollowing = async (req, res) => {
  try {
    const result = await userService.checkFollowing(
      req.user,
      req.params.userId
    );
    response.succsess(res, 200, result);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
exports.editProfile = async (req, res) => {
  try {
    const result = await userService.editProfile(req.files, req.body, req.user);
    response.succsess(res, 200, result);
  } catch (error) {
    console.error(error);
    response.error(res, 400, error.message);
  }
};
// search users
exports.search = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return response.succsess(res, 200, []);
    const users = await userService.search(q);
    response.succsess(res, 200, users);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};

exports.settings = async (req, res) => {
  try {
    await userService.setting(req.body, req.user);
    response.succsess(res, 201, true);
  } catch (error) {
    response.error(res, 400, error.message);
  }
};
