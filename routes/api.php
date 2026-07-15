<?php

use App\Http\Controllers\BotFlowController;
use App\Http\Controllers\AgendaContactController;
use App\Http\Controllers\AuditController;
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

$sessionAuthenticated = [
    \App\Http\Middleware\EncryptCookies::class,
    \Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse::class,
    \Illuminate\Session\Middleware\StartSession::class,
    \App\Http\Middleware\Authenticate::class,
];

Route::middleware($sessionAuthenticated)->group(function () {
    Route::post('/message/markAsRead/{chatId}', [ChatController::class, 'markAsReadMessages']);
    Route::get('/chat/messages/{chatId}', [ChatController::class, 'getMessages']);
    Route::get('/chats/snapshot', [ChatController::class, 'snapshot']);
    Route::post('/chats/{chat}/open', [ChatController::class, 'open']);
    Route::post('/message/send', [WhatsAppController::class, 'sendMessage']);
    Route::post('/message/send-media', [WhatsAppController::class, 'sendMedia']);
    Route::post('/message/send-contact', [WhatsAppController::class, 'sendContact']);
    Route::post('/chats/{chat}/bot', [WhatsAppController::class, 'updateBotStatus'])->middleware('permission:can_toggle_bot');
    Route::post('/chats/{chat}/operator', [ChatController::class, 'updateOperator'])->middleware('permission:can_assign_chats');
    Route::get('/chats/{chat}/media', [ChatMediaController::class, 'index']);
    Route::get('/agenda/contacts', [AgendaContactController::class, 'apiIndex']);
    Route::post('/agenda/contacts', [AgendaContactController::class, 'store']);
    Route::put('/agenda/contacts/{agendaContact}', [AgendaContactController::class, 'update']);
    Route::delete('/agenda/contacts/{agendaContact}', [AgendaContactController::class, 'destroy']);
    Route::post('/agenda/contacts/{id}/restore', [AgendaContactController::class, 'restore']);
    Route::delete('/agenda/contacts/{id}/force', [AgendaContactController::class, 'forceDestroy']);

    Route::middleware('permission:can_view_audit')->group(function () {
        Route::get('/audit/logs', [AuditController::class, 'logs']);
        Route::get('/audit/logs/tail', [AuditController::class, 'applicationLogs']);
    });

    Route::middleware('permission:can_manage_settings')->group(function () {
        Route::get('/settings/export', [SettingsController::class, 'exportConfiguration']);
        Route::post('/settings/import', [SettingsController::class, 'importConfiguration']);
        Route::post('/settings/general', [SettingsController::class, 'saveGeneral']);
        Route::post('/settings/integrations', [SettingsController::class, 'saveIntegrations']);
        Route::post('/settings/bot', [SettingsController::class, 'saveBot']);
    });

    Route::middleware('permission:can_manage_users')->group(function () {
        Route::put('/settings/users/{user}/role', [SettingsController::class, 'updateUserRole']);
    });

    Route::middleware('permission:can_view_flows')->group(function () {
        Route::get('/bot/flows', [BotFlowController::class, 'apiIndex']);
        Route::get('/bot/trash', [BotFlowController::class, 'trash']);
        Route::get('/bot/flows/{flow}/nodes', [BotFlowController::class, 'nodes']);
    });

    Route::middleware('permission:can_manage_flows')->group(function () {
        Route::post('/bot/flows', [BotFlowController::class, 'store']);
        Route::put('/bot/flows/{flow}', [BotFlowController::class, 'updateFlow']);
        Route::delete('/bot/flows/{flow}', [BotFlowController::class, 'destroyFlow']);
        Route::post('/bot/flows/{flowId}/restore', [BotFlowController::class, 'restoreFlow']);
        Route::post('/bot/flows/{flow}/make-default', [BotFlowController::class, 'makeDefault']);
        Route::put('/bot/flows/{flow}/start-node', [BotFlowController::class, 'setStartNode']);
        Route::post('/bot/media', [BotFlowController::class, 'uploadMedia']);
        Route::post('/bot/flows/{flow}/nodes', [BotFlowController::class, 'storeNode']);
        Route::put('/bot/nodes/{node}', [BotFlowController::class, 'updateNode']);
        Route::delete('/bot/nodes/{node}', [BotFlowController::class, 'destroyNode']);
        Route::post('/bot/nodes/{nodeId}/restore', [BotFlowController::class, 'restoreNode']);
    });
});





Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});
