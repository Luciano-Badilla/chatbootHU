<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class TurnoCancelado extends Mailable
{
    public $html;

    public function __construct($html)
    {
        $this->html = $html;
    }

    public function build()
    {
        return $this->subject('Turno cancelado')
            ->html($this->html);
    }
}

