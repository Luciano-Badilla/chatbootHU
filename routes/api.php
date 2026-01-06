<?php

use App\Http\Controllers\BotFlowController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\WhatsAppController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api" middleware group. Make something great!
|
*/

Route::get('/webhook', [WhatsAppController::class, 'verify']);
Route::post('/webhook', [WhatsAppController::class, 'receiveMessage']);
Route::post('/message/markAsRead/{chatId}', [ChatController::class, 'markAsReadMessages']);
Route::get('/chat/messages/{chatId}', [ChatController::class, 'getMessages']);
Route::post('/message/send', [WhatsAppController::class, 'sendMessage']);
Route::post('/chats/{chat}/bot', [WhatsAppController::class, 'updateBotStatus']);

Route::get('/bot/flows', [BotFlowController::class, 'apiIndex']);
Route::post('/bot/flows', [BotFlowController::class, 'store']);

Route::get('/bot/flows/{flow}/nodes', [BotFlowController::class, 'nodes']);
Route::post('/bot/flows/{flow}/nodes', [BotFlowController::class, 'storeNode']);
Route::put('/bot/nodes/{node}', [BotFlowController::class, 'updateNode']);





Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});
