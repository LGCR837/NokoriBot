<?php
/**
 * NokoriBot 插件广场 API
 *
 * 所有请求通过 api.php?action=xxx 路由
 * GET  /api.php?action=plugins          插件列表
 * GET  /api.php?action=plugin&id=xxx    插件详情
 * GET  /api.php?action=download&id=xxx  下载插件
 * POST /api.php?action=register         注册
 * POST /api.php?action=login            登录
 * POST /api.php?action=logout           登出
 * GET  /api.php?action=me               当前用户
 * POST /api.php?action=upload           上传插件
 * POST /api.php?action=delete           删除插件
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/functions.php';

// 首次访问自动安装
if (!isInstalled()) {
    jsonResponse(['error' => '未安装，请先访问 install.php 初始化数据库'], 503);
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';

switch ($action) {
    // ── 插件列表 ──
    case 'plugins':
        $plugins = listPlugins();
        jsonResponse(['plugins' => $plugins]);
        break;

    // ── 插件详情 ──
    case 'plugin':
        $id = $_GET['id'] ?? '';
        if (!$id) jsonResponse(['error' => '缺少 id'], 400);
        $plugin = getPlugin($id);
        if (!$plugin) jsonResponse(['error' => '插件不存在'], 404);
        jsonResponse($plugin);
        break;

    // ── 下载 ──
    case 'download':
        $id = $_GET['id'] ?? '';
        if (!$id) jsonResponse(['error' => '缺少 id'], 400);
        $plugin = getPlugin($id);
        if (!$plugin) jsonResponse(['error' => '插件不存在'], 404);

        $zipPath = PLUGINS_DIR . '/' . $id . '/' . ($plugin['filename'] ?? $id . '.zip');
        if (!file_exists($zipPath)) jsonResponse(['error' => '文件不存在'], 404);

        // 下载计数 +1
        $plugin['downloads'] = ($plugin['downloads'] ?? 0) + 1;
        savePluginMeta($id, $plugin);

        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . ($plugin['filename'] ?? $id . '.zip') . '"');
        header('Content-Length: ' . filesize($zipPath));
        readfile($zipPath);
        exit;

    // ── 注册 ──
    case 'register':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => '方法不允许'], 405);
        $body = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $username = trim($body['username'] ?? '');
        $password = $body['password'] ?? '';
        $displayName = trim($body['display_name'] ?? '') ?: $username;

        if (strlen($username) < 3 || strlen($username) > 32) {
            jsonResponse(['error' => '用户名长度 3-32'], 400);
        }
        if (strlen($password) < 6) {
            jsonResponse(['error' => '密码至少 6 位'], 400);
        }
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $username)) {
            jsonResponse(['error' => '用户名只能包含字母、数字、下划线'], 400);
        }

        $db = getDB();
        $stmt = $db->prepare('SELECT id FROM users WHERE username = ?');
        $stmt->execute([$username]);
        if ($stmt->fetch()) {
            jsonResponse(['error' => '用户名已存在'], 409);
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $db->prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)');
        $stmt->execute([$username, $hash, $displayName]);

        $userId = (int)$db->lastInsertId();
        login($userId, $username);
        jsonResponse(['ok' => true, 'user' => ['id' => $userId, 'username' => $username, 'display_name' => $displayName]]);
        break;

    // ── 登录 ──
    case 'login':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => '方法不允许'], 405);
        $body = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $username = trim($body['username'] ?? '');
        $password = $body['password'] ?? '';

        $db = getDB();
        $stmt = $db->prepare('SELECT id, username, password_hash, display_name FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            jsonResponse(['error' => '用户名或密码错误'], 401);
        }

        login((int)$user['id'], $user['username']);
        jsonResponse(['ok' => true, 'user' => ['id' => (int)$user['id'], 'username' => $user['username'], 'display_name' => $user['display_name']]]);
        break;

    // ── 登出 ──
    case 'logout':
        logout();
        jsonResponse(['ok' => true]);
        break;

    // ── 当前用户 ──
    case 'me':
        if (!isLoggedIn()) {
            jsonResponse(['logged_in' => false]);
        }
        $db = getDB();
        $stmt = $db->prepare('SELECT id, username, display_name, created_at FROM users WHERE id = ?');
        $stmt->execute([currentUserId()]);
        $user = $stmt->fetch();
        jsonResponse(['logged_in' => true, 'user' => $user]);
        break;

    // ── 上传插件 ──
    case 'upload':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => '方法不允许'], 405);
        $user = requireLogin();

        if (!isset($_FILES['plugin'])) {
            jsonResponse(['error' => '没有上传文件'], 400);
        }
        $file = $_FILES['plugin'];
        if ($file['error'] !== UPLOAD_ERR_OK) {
            jsonResponse(['error' => '上传失败，错误码: ' . $file['error']], 400);
        }
        if (strtolower(pathinfo($file['name'], PATHINFO_EXTENSION)) !== 'zip') {
            jsonResponse(['error' => '只接受 .zip 文件'], 400);
        }

        // 用 ZipArchive 读取 manifest.json
        $zip = new ZipArchive();
        if ($zip->open($file['tmp_name']) !== true) {
            jsonResponse(['error' => '无法打开 zip 文件'], 400);
        }

        $manifestContent = $zip->getFromName('manifest.json');
        if ($manifestContent === false) {
            // 有些插件可能在子目录里
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $name = $zip->getNameIndex($i);
                if (basename($name) === 'manifest.json') {
                    $manifestContent = $zip->getFromIndex($i);
                    break;
                }
            }
        }
        if ($manifestContent === false) {
            $zip->close();
            jsonResponse(['error' => 'zip 中没有 manifest.json'], 400);
        }

        $manifest = json_decode($manifestContent, true);
        if (!$manifest || empty($manifest['name'])) {
            $zip->close();
            jsonResponse(['error' => 'manifest.json 格式错误'], 400);
        }

        $pluginName = sanitizeFilename($manifest['name']);
        $version = $manifest['version'] ?? '0.0.0';

        // 检查同名插件版本
        $existing = getPlugin($pluginName);
        if ($existing && isset($existing['version']) && version_compare($version, $existing['version'], '<=')) {
            $zip->close();
            jsonResponse(['error' => "版本 $version 不高于已有版本 {$existing['version']}"], 400);
        }

        // 解压到 data/plugins/{name}/
        $destDir = PLUGINS_DIR . '/' . $pluginName;
        if (!is_dir($destDir)) mkdir($destDir, 0755, true);

        // 清理旧文件（保留 meta.json 和 .zip）
        $files = scandir($destDir);
        foreach ($files as $f) {
            if ($f === '.' || $f === '..' || $f === 'meta.json') continue;
            $fp = $destDir . '/' . $f;
            is_dir($fp) ? removeDir($fp) : unlink($fp);
        }

        $zip->extractTo($destDir);
        $zip->close();

        // 移动 zip 到插件目录
        $zipDest = $destDir . '/' . $pluginName . '.zip';
        move_uploaded_file($file['tmp_name'], $zipDest);

        // 写 meta.json
        $meta = [
            'name' => $pluginName,
            'version' => $version,
            'description' => $manifest['description'] ?? '',
            'author' => $manifest['author'] ?? '',
            'main' => $manifest['main'] ?? 'index.ts',
            'uploaded_by' => $user['username'],
            'uploaded_at' => date('Y-m-d H:i:s'),
            'downloads' => $existing['downloads'] ?? 0,
            'filename' => $pluginName . '.zip',
            'size' => filesize($zipDest),
        ];
        savePluginMeta($pluginName, $meta);

        jsonResponse(['ok' => true, 'plugin' => $meta]);
        break;

    // ── 删除插件 ──
    case 'delete':
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') jsonResponse(['error' => '方法不允许'], 405);
        $user = requireLogin();

        $body = json_decode(file_get_contents('php://input'), true) ?? $_POST;
        $id = $body['id'] ?? $_GET['id'] ?? '';
        if (!$id) jsonResponse(['error' => '缺少 id'], 400);

        $plugin = getPlugin($id);
        if (!$plugin) jsonResponse(['error' => '插件不存在'], 404);

        // 只有上传者可以删除
        if ($plugin['uploaded_by'] !== $user['username']) {
            jsonResponse(['error' => '只能删除自己上传的插件'], 403);
        }

        $dir = PLUGINS_DIR . '/' . $id;
        if (is_dir($dir)) removeDir($dir);

        jsonResponse(['ok' => true]);
        break;

    default:
        jsonResponse(['error' => '未知 action: ' . $action], 400);
}

// ── 辅助函数 ──
function removeDir(string $dir): void {
    $items = scandir($dir);
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . '/' . $item;
        is_dir($path) ? removeDir($path) : unlink($path);
    }
    rmdir($dir);
}
