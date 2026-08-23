<?php
// 数据库配置 — 部署时修改这里
define('DB_HOST', '127.0.0.1');
define('DB_PORT', 3306);
define('DB_NAME', 'nokoribot_marketplace');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_CHARSET', 'utf8mb4');

// 文件存储路径（相对于 marketplace/ 根目录）
define('DATA_DIR', __DIR__ . '/../data');
define('PLUGINS_DIR', DATA_DIR . '/plugins');

// 站点名称
define('SITE_NAME', 'NokoriBot 插件广场');
