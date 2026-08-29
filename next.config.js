/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: false,
  // better-sqlite3 is a native module — keep it external so Next doesn't try to bundle it.
  serverExternalPackages: ["better-sqlite3"],
};
