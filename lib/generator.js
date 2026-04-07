'use strict';

const { generateRssFeed, generateAtomFeed } = require('feedsmith');
const { gravatar, full_url_for, encodeURL } = require('hexo-util');

function composePosts(locals, feedConfig) {
  const { limit, order_by } = feedConfig;
  let posts;

  // Check if we are using the custom 'breaches' data or standard Hexo posts
  if (locals.data && locals.data.breaches && locals.data.breaches.breaches) {
    posts = locals.data.breaches.breaches
      .filter((item) => !item.Name || !item.Name.toLowerCase().includes('cve'))
      .map((item) => {
        item.permalink = "https://feed-blush.vercel.app/fuites?id=" + item.index;
        if (!item.date) {
          item.date = item.BreachDate;
        }
        return item;
      })
      .filter((item) => !item.IsRetired);

    // Sort by AddedDate (descending) as in original code
    posts.sort((a, b) => new Date(b.AddedDate) - new Date(a.AddedDate));
    
    if (limit) posts = posts.slice(0, limit);
  } else {
    posts = locals.posts.sort(order_by || '-date');
    posts = posts.filter(post => post.draft !== true);
    if (limit) posts = posts.limit(limit);
    posts = posts.toArray();
  }

  return posts;
}

function composeFeed(config, path, context, posts, locals) {
  const { feed: feedConfig, url: urlConfig, email } = config;
  const { icon: iconConfig, hub } = feedConfig;

  let url = urlConfig;
  if (url[url.length - 1] !== '/') url += '/';

  let icon = '';
  if (iconConfig) icon = full_url_for.call(context, iconConfig);
  else if (email) icon = gravatar(email);

  const feedUrl = full_url_for.call(context, path);
  const currentYear = new Date().getFullYear();

  let updated;
  if (locals.data && locals.data.breaches && locals.data.breaches.lastUpdated) {
    updated = new Date(locals.data.breaches.lastUpdated);
  } else if (posts.length > 0) {
    const firstPost = posts[0];
    updated = (firstPost.updated && typeof firstPost.updated.toDate === 'function') 
      ? firstPost.updated.toDate() 
      : new Date(firstPost.updated || firstPost.date || Date.now());
  } else {
    updated = new Date();
  }

  return {
    title: config.title,
    description: config.subtitle || config.description,
    url,
    feedUrl,
    icon,
    hub,
    language: config.language,
    author: { name: config.author, email: config.email },
    copyright: config.author && `All rights reserved ${currentYear}, ${config.author}`,
    updated
  };
}

function composeFeedLinks(feedUrl, hub, type) {
  const links = [{ href: encodeURL(feedUrl), rel: 'self', type }];
  if (hub) links.push({ href: encodeURL(hub), rel: 'hub' });
  return links;
}

function composeItemDescription(post, feedConfig) {
  const { content_limit, content_limit_delim } = feedConfig;

  // Support both standard Hexo post fields and custom breach fields
  const description = post.description || post.Description || post.intro || post.excerpt;
  
  if (description) {
    return description;
  } else if (post.content) {
    const short_content = post.content.substring(0, content_limit || 140);
    if (content_limit_delim) {
      const delim_pos = short_content.lastIndexOf(content_limit_delim);
      if (delim_pos > -1) {
        return short_content.substring(0, delim_pos);
      }
    }
    return short_content;
  }
  return '';
}

function composeItemContent(post, feedConfig) {
  const { content } = feedConfig;
  const postContent = post.content || post.Description; // Use Description as content for breaches

  if (content && postContent) {
    return postContent.replace(/[\x00-\x1F\x7F]/g, ''); // eslint-disable-line no-control-regex
  }
  return '';
}

function composeItemCategories(post) {
  if (!post.categories && !post.tags) return [];
  
  const items = [
    ...post.categories ? (typeof post.categories.toArray === 'function' ? post.categories.toArray() : post.categories) : [],
    ...post.tags ? (typeof post.tags.toArray === 'function' ? post.tags.toArray() : post.tags) : []
  ];
  return items.map(item => ({ name: item.name, domain: item.permalink }));
}

function composeItem(post, feedConfig, context) {
  // Mapping for both standard posts and custom breaches
  const title = post.Title || post.title;
  const link = post.permalink ? (post.permalink.startsWith('http') ? post.permalink : encodeURL(full_url_for.call(context, post.permalink))) : '';
  const published = (post.date && typeof post.date.toDate === 'function') ? post.date.toDate() : new Date(post.date || Date.now());
  const updated = (post.updated && typeof post.updated.toDate === 'function') ? post.updated.toDate() : new Date(post.updated || post.date || Date.now());

  return {
    title,
    link,
    description: composeItemDescription(post, feedConfig),
    published,
    updated,
    content: composeItemContent(post, feedConfig),
    enclosures: (post.image || post.lien) ? [{ url: full_url_for.call(context, post.image || post.lien) }] : [],
    categories: composeItemCategories(post)
  };
}

function composeRssItem(feed, item) {
  return {
    title: item.title,
    link: item.link,
    guid: item.link,
    description: item.description,
    pubDate: item.published,
    authors: [feed.author],
    content: { encoded: item.content },
    enclosures: item.enclosures,
    categories: item.categories
  };
}

function composeAtomEntry(feed, item) {
  const entryLinks = [
    { href: item.link },
    ...(item.enclosures || []).map(enclosure => ({ href: enclosure.url, rel: 'enclosure' }))
  ];

  return {
    title: item.title,
    id: item.link,
    links: entryLinks,
    summary: item.description,
    content: item.content,
    published: item.published,
    updated: item.updated || item.published,
    authors: feed.author.name && [feed.author],
    categories: item.categories.map(cat => ({ term: cat.name, scheme: cat.domain }))
  };
}

function generateRss(feed, items) {
  const links = composeFeedLinks(feed.feedUrl, feed.hub, 'application/rss+xml');

  return generateRssFeed({
    title: feed.title,
    description: feed.description,
    link: encodeURL(feed.url),
    language: feed.language,
    copyright: feed.copyright,
    generator: 'Hexo',
    lastBuildDate: feed.updated,
    image: feed.icon && {
      url: feed.icon,
      title: feed.title,
      link: encodeURL(feed.url)
    },
    atom: { links },
    items: items.map(item => composeRssItem(feed, item))
  }, { lenient: true });
}

function generateAtom(feed, items) {
  const links = [
    { href: encodeURL(feed.url), rel: 'alternate' },
    ...composeFeedLinks(feed.feedUrl, feed.hub)
  ];

  return generateAtomFeed({
    title: feed.title,
    id: encodeURL(feed.url),
    subtitle: feed.description,
    updated: feed.updated,
    links,
    generator: { text: 'Hexo', uri: 'https://hexo.io/' },
    icon: feed.icon,
    rights: feed.copyright,
    authors: feed.author.name && [feed.author],
    entries: items.map(item => composeAtomEntry(feed, item)),
    language: feed.language
  }, { lenient: true });
}

module.exports = function(locals, type, path) {
  const { config } = this;
  const { feed: feedConfig } = config;

  const posts = composePosts(locals, feedConfig);

  if (posts.length <= 0) {
    feedConfig.autodiscovery = false;
    return;
  }

  const feed = composeFeed(config, path, this, posts, locals);
  const items = posts.map(post => composeItem(post, feedConfig, this));

  let data;
  switch (type) {
    case 'rss2':
      data = generateRss(feed, items);
      break;
    default:
      data = generateAtom(feed, items);
  }

  return {
    path,
    data
  };
};
