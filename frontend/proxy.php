<?php
/**
 * Kleiner PHP-Proxy zur Umleitung von Frontend-Anfragen an ein lokales Backend.
 * Verhindert CORS-Probleme, da das Frontend mit dem Proxy auf derselben Domain kommuniziert.
 * 
 * ANWEISUNG FÜR DAS FRONTEND:
 * Um diesen Proxy zu nutzen, ändern Sie die 'API_BASE_URL' in Ihren JavaScript-Dateien 
 * (z.B. app.js, users.js) von 'http://localhost:8000' zu '/proxy.php'.
 */

// --- KONFIGURATION ---
// Die URL Ihres FastAPI-Backends
$backend_base_url = 'http://localhost:8000';

// --- LOGIK ---

// 1. Den Ziel-Pfad ermitteln
$request_uri = $_SERVER['REQUEST_URI'];
$proxy_file = basename(__FILE__);

// Wir suchen die Position der proxy.php in der URI
$pos = strpos($request_uri, $proxy_file);

if ($pos !== false) {
    // Wir nehmen alles, was NACH der proxy.php kommt
    $relative_path = substr($request_uri, $pos + strlen($proxy_file));
} else {
    // Falls die Datei nicht in der URI vorkommt
    $relative_path = $request_uri;
}

// Sicherstellen, dass der Pfad mit einem / beginnt, falls er nicht leer ist
if ($relative_path !== '' && $relative_path[0] !== '/') {
    $relative_path = '/' . $relative_path;
}

// Falls der Pfad nach der proxy.php leer ist (nur /proxy.php), behandeln wir ihn als Root-Pfad
if ($relative_path === '') {
    $relative_path = '/';
}

$target_url = $backend_base_url . $relative_path;

// 2. cURL initialisieren
$ch = curl_init($target_url);

// 3. HTTP-Methode übernehmen (GET, POST, PUT, DELETE, etc.)
$method = $_SERVER['REQUEST_METHOD'];
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);

// 4. Request-Body weiterleiten (wichtig für POST, PUT, PATCH)
$input = file_get_contents('php://input');
if (!empty($input)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $input);
}

// 5. Header weiterleiten
$headers = [];
foreach (getallheaders() as $key => $value) {
    // Wir ignorieren bestimmte Header, die cURL selbst korrekt setzt oder die Konflikte verursachen könnten
    if (in_array(strtolower($key), ['host', 'content-length', 'connection'])) {
        continue;
    }
    $headers[] = "$key: $value";
}
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

// 6. Antwort-Einstellungen
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true); // Wir wollen auch die Header vom Backend sehen

// 7. Anfrage ausführen
$response = curl_exec($ch);
$error = curl_error($ch);
$info = curl_getinfo($ch);
curl_close($ch);

if ($error) {
    http_response_code(502); // Bad Gateway
    echo json_encode([
        'error' => 'Proxy Error: ' . $error,
        'debug_target_url' => $target_url
    ]);
    exit;
}

// 8. Header und Body trennen
$header_size = $info['header_size'];
$response_headers = substr($response, 0, $header_size);
$response_body = substr($response, $header_size);

// 9. Antwort an den Client zurückgeben
// Status Code setzen
http_response_code($info['http_code']);

// Header vom Backend an den Client weiterreichen
$header_lines = explode("\r\n", $response_headers);
foreach ($header_lines as $line) {
    if (!empty($line) && !stripos($line, 'Transfer-Encoding')) {
        header($line);
    }
}

// Body ausgeben
echo $response_body;
