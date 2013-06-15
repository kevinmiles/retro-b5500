/***********************************************************************
* retro-b5500/emulator B5500CardReader.js
************************************************************************
* Copyright (c) 2013, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Card Reader Peripheral Unit module.
*
* Defines a card reader peripheral unit type.
*
************************************************************************
* 2013-06-05  P.Kimpel
*   Original version, from B5500SPOUnit.js.
***********************************************************************/
"use strict";

/**************************************/
function B5500CardReader(mnemonic, unitIndex, designate, statusChange, signal) {
    /* Constructor for the CardReader object */
    var that = this;

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.unitIndex = unitIndex;         // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (e.g,. SPO input request)

    this.clear();

    this.window = window.open("", mnemonic);
    if (this.window) {
        this.window.close();            // destroy the previously-existing window
        this.window = null;
    }
    this.doc = null;
    this.window = window.open("/B5500/webUI/B5500CardReader.html", mnemonic,
        "scrollbars=no,resizable,width=200,height=200");
    this.window.onload = function() {
        that.readerOnload();
    };
}
B5500CardReader.prototype.eolRex = /([^\n\r\f]*)((:?\r[\n\f]?)|\n|\f)?/g;

B5500CardReader.prototype.cardsPerMinute = 800;

B5500CardReader.prototype.cardFilter = [ // Filter ASCII character values to valid BIC ones
        0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,  // 00-0F
        0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,0x3F,  // 10-1F
        0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x3F,0x28,0x29,0x2A,0x2B,0x2C,0x2D,0x2E,0x2F,  // 20-2F
        0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,0x3A,0x3B,0x3C,0x3D,0x3E,0x3F,  // 30-3F
        0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 40-4F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x5B,0x3F,0x5D,0x3F,0x3F,  // 50-5F
        0x3F,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,  // 60-6F
        0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5A,0x7B,0x7C,0x7D,0x7E,0x3F]; // 70-7F

/**************************************/
B5500CardReader.prototype.$$ = function $$(e) {
    return this.doc.getElementById(e);
};

/**************************************/
B5500CardReader.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the reader unit state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status
    this.activeIOUnit = 0;              // I/O unit currently using this device

    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion

    this.buffer = "";                   // Card reader "input hopper"
    this.bufLength = 0;                 // Current input buffer length (characters)
    this.bufIndex = 0;                  // 0-relative offset to next "card" to be read
    this.eofArmed = false;              // EOF button: armed state
    this.stopCount = 0;                 // stopCount for clearing the input buffer
};

/**************************************/
B5500CardReader.prototype.hasClass = function hasClass(e, name) {
    /* returns true if element "e" has class "name" in its class list */
    var classes = e.className;

    if (!e) {
        return false;
    } else if (classes == name) {
        return true;
    } else {
        return (classes.search("\\b" + name + "\\b") >= 0);
    }
};

/**************************************/
B5500CardReader.prototype.addClass = function addClass(e, name) {
    /* Adds a class "name" to the element "e"s class list */

    if (!this.hasClass(e, name)) {
        e.className += (" " + name);
    }
};

/**************************************/
B5500CardReader.prototype.removeClass = function removeClass(e, name) {
    /* Removes the class "name" from the element "e"s class list */

    e.className = e.className.replace(new RegExp("\\b" + name + "\\b\\s*", "g"), "");
};

/**************************************/
B5500CardReader.prototype.setReaderReady = function setReaderReady(ready) {
    /* Controls the ready-state of the card reader */

    this.$$("CRFileSelector").disabled = ready;
    this.ready = ready;
    if (ready) {
        this.statusChange(1);
        this.removeClass(this.$$("CRNotReadyLight"), "redLit");
    } else {
        this.statusChange(0);
        this.addClass(this.$$("CRNotReadyLight"), "redLit");
    }
};

/**************************************/
B5500CardReader.prototype.armEOF = function armEOF(armed) {
    /* Controls the arming/disarming of the EOF signal when starting with
    an empty input hopper */

    this.eofArmed = armed;
    if (armed) {
        this.addClass(this.$$("CREOFBtn"), "redLit");
    } else {
        this.removeClass(this.$$("CREOFBtn"), "redLit");
    }
};

/**************************************/
B5500CardReader.prototype.CRStartBtn_onclick = function CRStartBtn_onclick(ev) {
    /* Handle the click event for the START button */
    var that = this;

    if (!this.ready) {
        this.stopCount = 0;
        if (this.bufIndex < this.bufLength) {
            this.setReaderReady(true);
        }
    }
};

/**************************************/
B5500CardReader.prototype.CRStopBtn_onclick = function CRStopBtn_onclick(ev) {
    /* Handle the click event for the STOP button */

    if (this.ready) {
        this.setReaderReady(false);
    } else if (this.eofArmed) {
        this.armEOF(false);
    } else if (this.bufIndex < this.bufLength) {
        if (this.stopCount < 3) {
            this.stopCount++;
        } else {
            if (confirm("Empty the " + this.mnemonic + " input hopper?")) {
                this.stopCount = 0;
                this.buffer = "";
                this.bufLength = 0;
                this.bufIndex = 0;
                this.$$("CRProgressBar").value = 0;
            }
        }
    }
};

/**************************************/
B5500CardReader.prototype.CREOFBtn_onclick = function CREOFBtn_onclick(ev) {
    /* Handle the click event for the EOF button */

    this.armEOF(!this.eofArmed);
};

/**************************************/
B5500CardReader.prototype.fileSelector_onChange = function fileSelector_onChange(ev) {
    /* Handle the <input type=file> onchange event when a file is selected */
    var f = ev.target.files[0];
    var reader = new FileReader();
    var that = this;

    function fileLoader_onLoad(ev) {
        /* Handle the onload event for a Text FileReader */

        if (that.bufIndex < that.bufLength) {
            that.buffer = that.buffer.substring(that.bufIndex) + ev.target.result;
        } else {
            that.buffer = ev.target.result;
        }

        that.bufIndex = 0;
        that.bufLength = that.buffer.length;
        that.$$("CRProgressBar").value = that.bufLength;
        that.$$("CRProgressBar").max = that.bufLength;
    }

    /********************
    alert("File selected: " + f.name +
            "\nModified " + f.lastModifiedDate +
            "\nType=" + f.type + ", Size=" + f.size + " octets");
    ********************/

    reader.onload = fileLoader_onLoad;
    reader.readAsText(f);
};

/**************************************/
B5500CardReader.prototype.readCardAlpha = function readCardAlpha(buffer, length) {
    /* Reads one card image from the buffer in alpha mode; pads or trims the
    image as necessary to the I/O buffer length. Invalid BCL characters are
    translated to ASCII "?" and the invalid character bit is set in the errorMask */
    var card;                           // card image
    var cardLength;                     // length of card image
    var match;                          // result of eolRex.exec()
    var x;                              // for loop index

    this.eolRex.lastIndex = this.bufIndex;
    match = this.eolRex.exec(this.buffer);
    if (!match) {
        cardLength = 0;
    } else {
        this.bufIndex += match[0].length;
        card = match[1];
        cardLength = card.length;
        if (length < cardLength) {
            cardLength = length;
        }
        for (x=0; x<cardLength; x++) {
            if ((buffer[x] = this.cardFilter[card.charCodeAt(x) & 0x7F]) == 0x3F) {     // intentional assignment
                this.errorMask |= 0x08;
            }
        }
    }

    while (cardLength < length) {
        buffer[cardLength++] = 0x20;    // pad with spaces
    }
};

/**************************************/
B5500CardReader.prototype.readCardBinary = function readCardBinary(buffer, length) {
    /* Reads one card image from the buffer in binary mode; pads or trims the
    image as necessary to the I/O buffer length. Invalid BCL characters are
    translated to ASCII "?", but are not reported in the errorMask */
    var card;                           // card image
    var cardLength;                     // length of card image
    var match;                          // result of eolRex.exec()
    var x;                              // for loop index

    this.eolRex.lastIndex = this.bufIndex;
    match = this.eolRex.exec(this.buffer);
    if (!match) {
        cardLength = 0;
    } else {
        this.bufIndex += match[0].length;
        card = match[1];
        cardLength = card.length;
        if (length < cardLength) {
            cardLength = length;
        }
        for (x=0; x<cardLength; x++) {
            buffer[x] = this.cardFilter[card.charCodeAt(x) & 0x7F];
        }
    }

    while (cardLength < length) {
        buffer[cardLength++] = 0x30;    // pad with ASCII zeroes
    }
};

/**************************************/
B5500CardReader.prototype.readerOnload = function readerOnload() {
    /* Initializes the reader window and user interface */
    var that = this;
    var x = (this.mnemonic == "CRA" ? 0 : this.window.outerWidth + 16);


    this.doc = this.window.document;
    this.doc.title = "retro-B5500 " + this.mnemonic;
    this.window.moveTo(x, 0);
    this.window.resizeTo(this.window.outerWidth+this.$$("CRDiv").scrollWidth-this.window.innerWidth+8,
                         this.window.outerHeight+this.$$("CRDiv").scrollHeight-this.window.innerHeight+8);

    this.armEOF(false);
    this.setReaderReady(false);

    this.$$("CRFileSelector").addEventListener("change", function(ev) {
        that.fileSelector_onChange(ev);
    }, false);

    this.$$("CRStartBtn").addEventListener("click", function(ev) {
        that.CRStartBtn_onclick(ev);
    }, false);

    this.$$("CRStopBtn").addEventListener("click", function(ev) {
        that.CRStopBtn_onclick(ev);
    }, false);

    this.$$("CREOFBtn").addEventListener("click", function(ev) {
        that.CREOFBtn_onclick(ev);
    }, false);
};

/**************************************/
B5500CardReader.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit. If the reader is not ready and the input
    buffer is empty and EOF is armed , returns EOF; otherwise if not ready,
    returns Not Ready */
    var that = this;

    this.errorMask = 0;
    if (this.busy) {
        finish(0x01, 0);                // report unit busy
    } else if (!this.ready) {
        if (this.eofArmed && this.bufIndex >= this.bufLength) {
            this.armEOF(false);
            finish(0x24, 0);            // report unit EOF + not ready
        } else {
            finish(0x04, 0);            // report unit not ready
        }
    } else {
        this.busy = true;
        if (mode == 0) {
            this.readCardAlpha(buffer, length);
        } else {
            this.readCardBinary(buffer, length);
        }
        if (this.bufIndex < this.bufLength) {
            this.$$("CRProgressBar").value = this.bufLength-this.bufIndex;
        } else {
            this.$$("CRProgressBar").value = 0;
            this.buffer = "";           // discard the input buffer
            this.bufLength = 0;
            this.bufIndex = 0;
            this.setReaderReady(false);
        }

        setTimeout(function() {
            that.busy = false;
            finish(that.errorMask, length);
        }, 60000/this.cardsPerMinute);
    }
};

/**************************************/
B5500CardReader.prototype.space = function space(finish, length, control) {
    /* Initiates a space operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit */

    finish(0x04);                       // report unit not ready
};

/**************************************/
B5500CardReader.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.rewind = function rewind(finish) {
    /* Initiates a rewind operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.readCheck = function readCheck(finish, length, control) {
    /* Initiates a read check operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.readInterrogate = function readInterrogate(finish, control) {
    /* Initiates a read interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};

/**************************************/
B5500CardReader.prototype.writeInterrogate = function writeInterrogate(finish, control) {
    /* Initiates a write interrogate operation on the unit */

    finish(0x04, 0);                    // report unit not ready
};
