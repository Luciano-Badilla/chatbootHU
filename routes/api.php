<?php

use App\Http\Controllers\BotFlowController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\ChatMediaController;
use App\Http\Controllers\SettingsController;
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
Route::get('/chats/snapshot', [ChatController::class, 'snapshot']);
Route::post('/message/send', [WhatsAppController::class, 'sendMessage']);
Route::post('/message/send-media', [WhatsAppController::class, 'sendMedia']);
Route::post('/chats/{chat}/bot', [WhatsAppController::class, 'updateBotStatus']);
Route::post('/chats/{chat}/operator', [ChatController::class, 'updateOperator']);
Route::post('/settings/general', [SettingsController::class, 'saveGeneral']);
Route::post('/settings/integrations', [SettingsController::class, 'saveIntegrations']);

Route::get('/bot/flows', [BotFlowController::class, 'apiIndex']);
Route::get('/bot/trash', [BotFlowController::class, 'trash']);
Route::post('/bot/flows', [BotFlowController::class, 'store']);
Route::put('/bot/flows/{flow}', [BotFlowController::class, 'updateFlow']);
Route::delete('/bot/flows/{flow}', [BotFlowController::class, 'destroyFlow']);
Route::post('/bot/flows/{flowId}/restore', [BotFlowController::class, 'restoreFlow']);
Route::post('/bot/flows/{flow}/make-default', [BotFlowController::class, 'makeDefault']);
Route::put('/bot/flows/{flow}/start-node', [BotFlowController::class, 'setStartNode']);
Route::get('/bot/flows/{flow}/nodes', [BotFlowController::class, 'nodes']);
Route::post('/bot/flows/{flow}/nodes', [BotFlowController::class, 'storeNode']);
Route::put('/bot/nodes/{node}', [BotFlowController::class, 'updateNode']);
Route::delete('/bot/nodes/{node}', [BotFlowController::class, 'destroyNode']);
Route::post('/bot/nodes/{nodeId}/restore', [BotFlowController::class, 'restoreNode']);
Route::get('/chats/{chat}/media', [ChatMediaController::class, 'index']);





Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});
