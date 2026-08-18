<?php

use App\Http\Controllers\AgendaContactController;
use App\Http\Controllers\AuditController;
use App\Http\Controllers\BotFlowController;
use App\Http\Controllers\CampaignController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\SettingsController;
use App\Models\Chat;
use App\Models\Message;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| contains the "web" middleware group. Now create something great!
|
*/

Route::get('/test-broadcast', function () {
    broadcast(new \App\Events\NewMessage(Chat::first(), Message::first()));

    return 'Evento enviado';
});

Route::get('/', function () {
    return redirect('/dashboard');
});

Route::middleware('auth')->group(function () {
    Route::get('/dashboard', [DashboardController::class, 'index'])->name('dashboard');

    Route::get('/chat-panel', [ChatController::class, 'index']);
    Route::get('/agenda-panel', [AgendaContactController::class, 'index']);
    Route::get('/campaigns-panel', [CampaignController::class, 'index'])->middleware('permission:can_manage_campaigns');

    Route::get('/bot/flows', [BotFlowController::class, 'index'])->middleware('permission:can_view_flows');
    Route::get('/settings-panel', [SettingsController::class, 'index'])->middleware('permission:can_manage_settings');
    Route::get('/audit-panel', [AuditController::class, 'index'])->middleware('permission:can_view_audit');
    Route::put('/settings-panel/general', [SettingsController::class, 'saveGeneral'])->middleware('permission:can_manage_settings');
    Route::post('/settings-panel/general', [SettingsController::class, 'saveGeneral'])->middleware('permission:can_manage_settings');

    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');
});

require __DIR__.'/auth.php';
