<?php
/**
 * 初始化数据库
 * 首次部署时访问一次即可，也可以重复执行（幂等）
 */
require_once __DIR__ . '/includes/db.php';
require_once __DIR__ . '/includes/functions.php';

$message = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $db = getDB();

        // 建 users 表
        $db->exec("
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(32) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                display_name VARCHAR(64) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");

        // 创建默认管理员
        $adminUser = 'admin';
        $adminPass = 'admin123';
        $stmt = $db->prepare('SELECT id FROM users WHERE username = ?');
        $stmt->execute([$adminUser]);
        if (!$stmt->fetch()) {
            $hash = password_hash($adminPass, PASSWORD_DEFAULT);
            $db->prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
               ->execute([$adminUser, $hash, '管理员']);
            $message = "安装完成！默认管理员账号: <b>$adminUser</b> 密码: <b>$adminPass</b><br>请登录后立即修改密码。";
        } else {
            $message = '数据库已存在，跳过创建。';
        }

        // 标记已安装
        file_put_contents(DATA_DIR . '/.installed', date('c'));

        // 确保目录存在
        if (!is_dir(PLUGINS_DIR)) mkdir(PLUGINS_DIR, 0755, true);

    } catch (PDOException $e) {
        $error = '数据库错误: ' . $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>初始化 - NokoriBot 插件广场</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f11; color: #e4e4e7; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .box { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 40px; max-width: 440px; width: 100%; }
        h1 { font-size: 1.4rem; margin-bottom: 8px; }
        p { color: #a1a1aa; font-size: 0.9rem; margin-bottom: 16px; }
        .ok { background: #052e16; border: 1px solid #16a34a; color: #4ade80; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; }
        .err { background: #2d0a0a; border: 1px solid #dc2626; color: #f87171; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 0.9rem; }
        button { background: #6d28d9; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 0.95rem; cursor: pointer; width: 100%; }
        button:hover { background: #7c3aed; }
        a { color: #a78bfa; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
<div class="box">
    <h1>NokoriBot 插件广场</h1>
    <p>首次部署需要初始化数据库</p>

    <?php if ($message): ?>
        <div class="ok"><?= $message ?></div>
        <a href="index.php">→ 进入插件广场</a>
    <?php elseif ($error): ?>
        <div class="err"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>

    <?php if (!$message): ?>
    <form method="post">
        <p>点击下方按钮将创建 <code>users</code> 表和默认管理员账号。</p>
        <button type="submit">开始安装</button>
    </form>
    <?php endif; ?>
</div>
</body>
</html>
