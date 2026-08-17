function serializeUser(user) {
  if (!user) return user;
  return {
    id: user.id,
    first_name: user.firstName,
    last_name: user.lastName,
    email: user.email,
    two_factor_enabled: user.twoFactorEnabled,
    username: user.username,
    fullname: user.fullname,
    avatar: user.avatar,
    title: user.title,
    about: user.about,
    likes_count: user.likesCount,
    posts_count: user.postsCount,
    follower_count: user.followerCount,
    following_count: user.followingCount,
    address: user.address,
    website_url: user.websiteUrl,
    twitter_url: user.twitterUrl,
    github_url: user.githubUrl,
    linkedin_url: user.linkedinUrl,
    location: user.location,
    skills: user.skills,
    badges: user.badges,
    cover_image: user.coverImage,
    verified_at: user.verifiedAt,
    settings: user.setting ? { data: JSON.stringify(user.setting.data) } : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeTag(tag) {
  if (!tag) return tag;
  return { id: tag.id, name: tag.name };
}

function serializeTopic(topic) {
  if (!topic) return topic;
  return {
    id: topic.id,
    name: topic.name,
    slug: topic.slug,
    image: topic.image,
    description: topic.description,
    posts_count: topic.postsCount,
  };
}

function serializePost(post) {
  return {
    id: post.id,
    user: post.user ? serializeUser(post.user) : undefined,
    topics: Array.isArray(post.topics) ? post.topics.map(serializeTopic) : [],
    tags: Array.isArray(post.tags) ? post.tags.map(serializeTag) : [],
    title: post.title,
    thumbnail: post.thumbnail,
    description: post.description,
    meta_title: post.metaTitle,
    meta_description: post.metaDescription,
    content: post.content,
    slug: post.slug,
    status: post.status,
    visibility: post.visibility,
    views_count: post.viewsCount,
    likes_count: post.likesCount,
    published_at: post.publishedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function serializeComment(comment) {
  return {
    id: comment.id,
    post_id: comment.postId,
    parent_id: comment.parentId,
    user: comment.user ? serializeUser(comment.user) : undefined,
    content: comment.content,
    like_count: comment.likeCount,
    is_like: comment.is_like,
    deleted_at: comment.deletedAt,
    edited_at: comment.editedAt,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    replies: Array.isArray(comment.replies) ? comment.replies.map(serializeComment) : undefined,
  };
}

module.exports = {
  serializeUser,
  serializeTag,
  serializeTopic,
  serializePost,
  serializeComment,
};
