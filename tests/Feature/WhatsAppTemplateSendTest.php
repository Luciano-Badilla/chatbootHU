<?php

namespace Tests\Feature;

use App\Models\Chat;
use App\Models\Contact;
use App\Models\Message;
use App\Models\User;
use App\Models\WhatsAppTemplate;
use App\Services\AuditService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Mockery;
use PhpMqtt\Client\MqttClient;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use Tests\TestCase;

#[RunTestsInSeparateProcesses]
#[PreserveGlobalState(false)]
class WhatsAppTemplateSendTest extends TestCase
{
    public function createApplication(): \Illuminate\Foundation\Application
    {
        $app = require __DIR__.'/../../bootstrap/app.php';
        $app->afterBootstrapping(LoadConfiguration::class, function ($app) {
            $app['config']->set('app.url', 'http://localhost');
            $app['config']->set('database.default', 'sqlite');
            $app['config']->set('database.connections.sqlite.database', ':memory:');
        });
        $app->make(Kernel::class)->bootstrap();

        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware();
        $this->actingAs(new User(['name' => 'Operadora']));
        Http::preventStrayRequests();
        $_ENV['WHATSAPP_ACCESS_TOKEN'] = 'token-de-prueba';
        $_ENV['WHATSAPP_PHONE_ID'] = '1234567890';

        Schema::create('contacts', function (Blueprint $table) {
            $table->id();
            $table->string('whatsapp_id')->nullable();
            $table->string('name')->nullable();
            $table->string('profile_pic')->nullable();
            $table->timestamps();
        });
        Schema::create('chats', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('contact_id')->nullable();
            $table->string('channel')->nullable();
            $table->string('webchat_token')->nullable();
            $table->timestamp('last_operator_message_at')->nullable();
            $table->timestamps();
        });
        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('chat_id');
            foreach (['sender', 'sender_subtype', 'operator_name', 'bot_node_type',
                'interactive_options', 'message_type', 'body', 'template_name',
                'template_language', 'status', 'whatsapp_message_id'] as $column) {
                $table->text($column)->nullable();
            }
            $table->timestamps();
        });
        Schema::create('whatsapp_templates', function (Blueprint $table) {
            $table->id();
            $table->string('meta_template_id')->nullable();
            $table->string('name');
            $table->string('language');
            $table->string('category')->nullable();
            $table->string('status');
            $table->text('body');
            $table->text('meta_components')->nullable();
            $table->boolean('is_supported')->default(true);
            $table->text('variable_keys')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();
        });
    }

    public function test_approved_template_is_sent_to_whatsapp_chat_and_saved_in_history(): void
    {
        $contact = Contact::create(['whatsapp_id' => '5493811234567', 'name' => 'Ana']);
        $chat = Chat::create(['channel' => 'whatsapp', 'contact_id' => $contact->id]);
        $template = $this->approvedTemplate();
        Http::fake(['graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.tpl']]])]);
        $this->expectAudit('template_sent');
        $mqtt = $this->mockMqtt();
        $mqtt->shouldReceive('publish')->twice();

        $this->postJson('/api/message/send-template', [
            'chat_id' => $chat->id,
            'whatsapp_template_id' => $template->id,
            'variables' => ['variable_1' => ' Ana ', 'variable_2' => "lunes\n10:00"],
        ])->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('message.sender_subtype', 'operator')
            ->assertJsonPath('message.message_type', 'template');

        Http::assertSent(fn ($request) => $request['to'] === '543811234567'
            && $request['type'] === 'template'
            && $request['template']['name'] === 'recordatorio_turno'
            && $request['template']['language']['code'] === 'es_AR'
            && $request['template']['components'][0]['parameters'][0]['text'] === 'Ana'
            && $request['template']['components'][0]['parameters'][1]['text'] === 'lunes 10:00');
        Http::assertSentCount(1);

        $message = Message::sole();
        $this->assertSame('Hola Ana, tu turno es el lunes 10:00.', $message->body);
        $this->assertSame('recordatorio_turno', $message->template_name);
        $this->assertSame('Operadora', $message->operator_name);
        $this->assertSame('wamid.tpl', $message->whatsapp_message_id);
    }

    public function test_webchat_chats_never_receive_templates(): void
    {
        $contact = Contact::create(['name' => 'Visitante']);
        $chat = Chat::create(['channel' => 'webchat', 'contact_id' => $contact->id]);
        $template = $this->approvedTemplate();

        $this->postJson('/api/message/send-template', [
            'chat_id' => $chat->id,
            'whatsapp_template_id' => $template->id,
            'variables' => ['variable_1' => 'Ana', 'variable_2' => 'lunes'],
        ])->assertUnprocessable();

        Http::assertNothingSent();
        $this->assertSame(0, Message::count());
    }

    public function test_empty_variables_are_rejected_before_calling_meta(): void
    {
        $contact = Contact::create(['whatsapp_id' => '543811234567']);
        $chat = Chat::create(['channel' => 'whatsapp', 'contact_id' => $contact->id]);
        $template = $this->approvedTemplate();

        $this->postJson('/api/message/send-template', [
            'chat_id' => $chat->id,
            'whatsapp_template_id' => $template->id,
            'variables' => ['variable_1' => 'Ana', 'variable_2' => '   '],
        ])->assertUnprocessable()->assertJsonPath('error', 'Completá la variable variable_2 antes de enviar.');

        Http::assertNothingSent();
        $this->assertSame(0, Message::count());
    }

    public function test_templates_that_are_not_approved_are_rejected(): void
    {
        $contact = Contact::create(['whatsapp_id' => '543811234567']);
        $chat = Chat::create(['channel' => 'whatsapp', 'contact_id' => $contact->id]);
        $template = $this->approvedTemplate(['status' => 'PENDING']);

        $this->postJson('/api/message/send-template', [
            'chat_id' => $chat->id,
            'whatsapp_template_id' => $template->id,
            'variables' => ['variable_1' => 'Ana', 'variable_2' => 'lunes'],
        ])->assertUnprocessable();

        Http::assertNothingSent();
    }

    public function test_meta_failure_is_audited_and_not_saved_as_sent(): void
    {
        $contact = Contact::create(['whatsapp_id' => '543811234567']);
        $chat = Chat::create(['channel' => 'whatsapp', 'contact_id' => $contact->id]);
        $template = $this->approvedTemplate();
        Http::fake(['graph.facebook.com/*' => Http::response(['error' => ['message' => 'Template name does not exist']], 400)]);
        $this->expectAudit('template_send_failed');

        $this->postJson('/api/message/send-template', [
            'chat_id' => $chat->id,
            'whatsapp_template_id' => $template->id,
            'variables' => ['variable_1' => 'Ana', 'variable_2' => 'lunes'],
        ])->assertStatus(500)->assertJsonPath('error', 'Error enviando plantilla a WhatsApp');

        $this->assertSame(0, Message::count());
    }

    private function approvedTemplate(array $overrides = []): WhatsAppTemplate
    {
        return WhatsAppTemplate::create(array_merge([
            'meta_template_id' => '987',
            'name' => 'recordatorio_turno',
            'language' => 'es_AR',
            'category' => 'UTILITY',
            'status' => 'APPROVED',
            'body' => 'Hola {{1}}, tu turno es el {{2}}.',
            'is_supported' => true,
            'variable_keys' => ['variable_1', 'variable_2'],
        ], $overrides));
    }

    private function expectAudit(string $event): void
    {
        $this->mock(AuditService::class, function ($mock) use ($event) {
            $mock->shouldReceive('recordMessageAction')->once()->with($event, Mockery::any(),
                Mockery::type(Chat::class), Mockery::type(User::class), Mockery::any(), Mockery::any());
        });
    }

    private function mockMqtt()
    {
        $_ENV['MQTT_HOST'] = $_ENV['VITE_MOSQUITTO_HOST'] = 'mqtt.test';
        $mqtt = Mockery::mock('overload:'.MqttClient::class);
        $mqtt->shouldReceive('connect')->once();
        $mqtt->shouldReceive('disconnect')->once();

        return $mqtt;
    }
}
