/***********************************************************************
* retro-b5500/emulator B5500DiskUnit.js
************************************************************************
* Copyright (c) 2013, Nigel Williams and Paul Kimpel.
* Licensed under the MIT License, see
*       http://www.opensource.org/licenses/mit-license.php
************************************************************************
* B5500 Disk File Control Unit module.
*
* Defines a peripheral unit type for the Disk File Control Unit (DFCU) used
* with Burroughs Model-I and Model-IB Head-per-Track disk units. The DFCU is
* the addressable unit to the B5500. This module manages the Electronic Units
* (EU) and Storage Units (SU) that make up the physical disk storage facility.
*
* Physical storage in this implementation is provided by a W3C IndexedDB
* data base local to the browser in which the emulator is running. There may
* be multiple of these data bases, but only one may be selected for use by an
* instance of the emulator at a time. The data base will be initialized to a
* default configuration the first time the emulator is used, and may be
* modified using the system configuration UI in the B5500 Console, but see
* below for considerations when using an existing data base from emulator
* versions 0.20 and earlier.
*
* The data base consists of a CONFIG object store and some number of "EUn"
* object stores, where n is in 0..19. The CONFIG store contains an "EUn" member
* for each such object store that specifies the characteristics of that EU:
*
*       size:           is the capacity of the EU in segments:
*                           40000-200000 for Model-I disk
*                           80000-400000 for Model-IB (slow) disk.
*       slow:           indicates Model-I (false) or Model-IB (true) disk,
*       lockoutMask:    is a binary integer, the low-order 20 bits of which
*                       represent the 20 disk lockout switches. A bit in this
*                       mask will be 1 if the associated switch is on. If
*                       this integer is negative, that indicates the master
*                       lockout switch is on. [not presently implemented]
*
* There may be gaps in the EU numbering, but the EU sizes should be specified
* in increments of 40,000 up to a maximum of 200,000 (for Model-I) or 400,000
* (for Model-IB "slow" disks). The configuration UI enforces this automatically.
*
* The Model-I SU was the original Head-per-Track disk module. Model-IB disk
* offered twice the storage capacity, but rotated at half the speed, allowing
* a higher bit density on the disk surface, but maintaining the same effective
* character transfer rate (96,000 characters/second) through the DFCU.
*
* For emulator versions 0.20 and earlier, the CONFIG structure had a simpler
* structure. Each EU member was a number indicating the size of the EU in
* segments. In order to allow backward compatibility with older emulator
* versions, the configuration UI will attempt to preserve this older format,
* and this device driver will accept that format, assuming Model-I disk and
* a lockoutMask of 0. This will allow older versions of the emulator to
* continue to use the IndexedDB data base. Once the configuration of such a
* data base is changed, however, it will no longer be compatible with the
* older version of the emulator, as the older emulator requires the IndexedDB
* data base version to be 1.
*
* Within an EU, segments are represented in the data base as 240-byte Uint8Array
* objects, each with a data base key corresponding to its numeric segment address.
* The segments in an EU are not pre-allocated, but are created as they are
* written by IDB put() methods. When reading, any unallocated segments are
* returned with their bytes set to 0x23 (#), which will be translated by the
* IOU to BIC "0" for alpha mode and BIC "#" for binary mode.
*
* Note that all disk I/O is done in units of 240-character segments. The
* interface with the I/O Unit uses lengths in terms of characters, however.
* All lengths SHOULD be multiples of 240 characters; any other values will be
* rounded up to the next multiple of 240. The I/O Unit is responsible for any
* padding or truncation to account for differences between the segment count
* and word count in the IOD. This implementation ignores binary vs. alpha mode
* and assumes the IOU does any necessary translation.
*
* The starting disk segment address for an I/O is passed in the "control"
* parameter to each of the I/O methods. This is an an alphanumeric value in
* the B5500 memory and I/O Unit. The I/O unit translates this value to binary
* for the "control" parameter. The low-order six decimal digits of the value
* comprise the segment address within the EU. The seventh decimal digit is the
* EU number. Any other portion of the value is ignored.
*
* The DFCU's "read check" operation is asynchronous with respect to the IOU, and
* the I/O operation itself completes almost immediately. Because of this, any
* error reporting for the read check is deferred until the next I/O operation
* (typically an interrogate) against the unit. Therefore, the error mask is
* cleared at the end of each disk I/O operation (except for read check) instead
* of at the beginning, and new  errors are OR-ed with any errors persisting from
* the prior operation.
*
* This module attempts to simulate actual disk activity times by delaying the
* finish() call by an amount of time computed from the numbers of sectors
* requested and the 96KC average transfer rate produced by the DFCU, plus a
* random distribution across an SU's 40ms max rotational latency time.
*
* When there are two DFCUs in the system, the way that they address the EUs
* depends on the presence of a Disk File Exchange (DFX). When a DFX is present,
* either DFCU may access any EU in the range 0-9. EUs 10-19 are not accessible.
* This limits storage to a maximum of 10 EUs (480 million characters). When a DFX
* is not present, DKA will address EU 0-9 and DKB will address EU 10-19,
* providing for a maximum of 20 EUs (960 million characters).
*
* This implementation supports configurations with or without a DFX. Note,
* however, that software support for a DFX is enabled by an MCP compile-time
* option ("$SET DFX=TRUE"). The setting of the MCP's DFX option *MUST MATCH*
* the DFX setting in the system configuration.
*
*                            W A R N I N G !
*                            ---------------
*       Attempting to run a DFX-enabled MCP on a non-DFX hardware
*       configuration, or vice versa, will likely corrupt the data
*       in the disk subsystem and require a Cold Start to resolve.
*
* The File Protect Memory (FPM), used with shared-disk systems is not supported
* at present. Disk write lockout is also not supported.
*
************************************************************************
* 2013-01-19  P.Kimpel
*   Original version, cloned from B5500DummyUnit.js.
* 2014-08-25  P.Kimpel
*   Adapt to new EU configuration object format and selectable data bases.
***********************************************************************/
"use strict";

/**************************************/
function B5500DiskUnit(mnemonic, index, designate, statusChange, signal, options) {
    /* Constructor for the DiskUnit object */

    this.mnemonic = mnemonic;           // Unit mnemonic
    this.index = index;                 // Ready-mask bit number
    this.designate = designate;         // IOD unit designate number
    this.statusChange = statusChange;   // external function to call for ready-status change
    this.signal = signal;               // external function to call for special signals (e.g,. SPO input request)
    this.options = options;             // device options from system configuration

    this.timer = 0;                     // setCallback() token
    this.initiateStamp = 0;             // timestamp of last initiation (set by IOUnit)
    this.config = null;                 // copy of CONFIG store contents
    this.db = null;                     // the IDB data base object
    this.sectorBuf = new Uint8Array(240); // sector buffer used by write()
    this.euPrefix =                     // prefix for EU object store names
            (mnemonic=="DKA" || options.DFX ? "EU" : "EU1");

    this.stdFinish = B5500DiskUnit.prototype.stdFinish.bind(this);

    this.clear();
    this.openDatabase();                // attempt to open the IDB data base
}

B5500DiskUnit.prototype.charXferRate = 96;      // avg. transfer rate [characters/ms = KC/sec]
B5500DiskUnit.prototype.modelILatency = 40;     // Model-I disk max rotational latency [ms]
B5500DiskUnit.prototype.modelIBLatency = 80;    // Model-IB disk max rotational latency [ms]

/**************************************/
B5500DiskUnit.prototype.clear = function clear() {
    /* Initializes (and if necessary, creates) the processor state */

    this.ready = false;                 // ready status
    this.busy = false;                  // busy status

    this.errorMask = 0;                 // error mask for finish()
    this.finish = null;                 // external function to call for I/O completion
    this.startStamp = null;             // I/O starting timestamp
};

/**************************************/
B5500DiskUnit.prototype.stdFinish = function stdFinish(errorMask, length) {
    /* Standard error reporting and I/O finish routine for the disk unit */

    this.finish(this.errorMask | (errorMask || 0), length);
    this.errorMask = 0;
};

/**************************************/
B5500DiskUnit.prototype.genericIDBError = function genericIDBError(ev) {
    /* Formats a generic alert when otherwise-unhandled data base errors occur */

    this.stdFinish(0x20, 0);            // set a generic disk-parity error
    alert("Disk \"" + this.mnemonic + "\" data base error: " + ev.target.result.error);
};

/**************************************/
B5500DiskUnit.prototype.copySegment = function copySegment(seg, buffer, offset) {
    /* Copies the bytes from a single segment Uint8Array object to "buffer" starting
    at "offset" for 240 bytes. If "seg" is undefined, copies bytes of zero instead */
    var x;

    if (seg) {
        for (x=0; x<240; x++) {
            buffer[offset+x] = seg[x];
        }
    } else {
        for (x=offset+239; x>=offset; x--) {
            buffer[x] = 0x23;           // ASCII "#", translates as alpha to BIC "0" = @00
        }
    }
};

/**************************************/
B5500DiskUnit.prototype.loadStorageConfig = function loadStorageConfig(storageConfig) {
    /* Loads the storage configuration object from the storage data base and
    sets up the internal representation of that object for use by the driver */
    var config = B5500Util.deepCopy(storageConfig);
    var eu;
    var euRex = /^EU\d{1,2}$/;
    var name;

    for (name in config) {              // for each property in the config
        if (name.search(euRex) == 0) {  // filter name for "EUn" or "EU1n"
            eu = config[name];
            eu.maxLatency = (eu.slow ? this.modelIBLatency : this.modelILatency);
            eu.charXferRate = this.charXferRate;
        }
    }
    this.config = config;
};

/**************************************/
B5500DiskUnit.prototype.openDatabase = function openDatabase() {
    /* Attempts to open the disk subsystem data base specified by
    this.options.storageName. If successful, loads the EU configuration,
    sets this.db to the IDB object, and sets the DFCU to ready status */
    var dsc = new B5500DiskStorageConfig();
    var that = this;

    function openStorageDB(config) {
        var req;

        if (!config) {
            that.config = null;
            alert(that.mnemonic + ": CONFIG structure does not exist in\ndata base \"" +
                  that.options.storageName + "\" -- must recreate storage DB");
        } else {
            req = indexedDB.open(that.options.storageName);     // accept any data base version

            req.onerror = function idbOpenOnerror(ev) {
                alert("Cannot open " + that.mnemonic + " Disk Subsystem\ndata base \"" +
                      that.options.storageName + "\":\n" + ev.target.error);
            };

            req.onblocked = function idbOpenOnblocked(ev) {
                alert(that.mnemonic + " Disk Subsystem open is blocked -- CANNOT CONTINUE");
            };

            req.onupgradeneeded = function idbOpenOnupgradeneeded(ev) {
                req.transaction.abort();
                ev.target.result.close();
                alert(that.mnemonic + " Disk Subsystem missing or requires version upgrade -- CANNOT CONTINUE");
            };

            req.onsuccess = function idbOpenOnsuccess(ev) {
                // Save the DB object reference globally for later use
                that.db = ev.target.result;
                // Set up the generic error handler
                that.db.onerror = that.genericIDBError.bind(that);
                that.loadStorageConfig(config);
                that.statusChange(1);   // now report the DFCU as ready to Central Control
                dsc.closeStorageDB();
                dsc = null;
            };
        }
    }

    this.statusChange(0);               // initially force DFCU status to not ready
    dsc.getStorageConfig(this.options.storageName, openStorageDB.bind(this));
};

/**************************************/
B5500DiskUnit.prototype.read = function read(finish, buffer, length, mode, control) {
    /* Initiates a read operation on the unit. "length" is in characters; segment address
    is in "control". "mode" is ignored (any translation would have been done by IOU) */
    var bx = 0;                         // current buffer offset
    var eu;                             // EU characteristics object
    var finishTime;                     // predicted time of I/O completion, ms
    var range;                          // key range for multi-segment read
    var req;                            // IDB request object
    var that = this;                    // local object context
    var txn;                            // IDB transaction object

    var segs = Math.floor((length+239)/240);
    var segAddr = control % 1000000;    // starting seg address
    var euNumber = (control % 10000000 - segAddr)/1000000;
    var euName = this.euPrefix + euNumber;
    var endAddr = segAddr+segs-1;       // ending seg address

    this.finish = finish;               // for global error handler
    eu = this.config[euName];
    if (!eu) {                          // EU does not exist
        this.stdFinish(0x20, 0);        // set D27F for EU not ready/not present
    } else if (segAddr < 0) {
        this.stdFinish(0x20, 0);        // set D27F for invalid starting seg address
    } else {
        if (endAddr >= eu.size) {       // if read is past end of disk
            this.errorMask |= 0x20;     // set D27F for invalid seg address
            segs = eu.size-segAddr;     // compute number of segs possible to read
            length = segs*240;          // recompute length and ending seg address
            endAddr = eu.size-1;
        }
        finishTime = this.initiateStamp +
                this.initiateStamp%eu.maxLatency + segs*240/eu.charXferRate;

        if (segs < 1) {                 // No length specified, so just finish the I/O
            this.stdFinish(0, 0);
        } else {
            txn = this.db.transaction(euName);
            txn.onerror = function writeTxnOnError(ev) {
                console.log(euName + " read txn onerror: " + ev.target.error.name);
                that.stdFinish(0x20, 0);
            };
            txn.onabort = function writeTxnOnAbort(ev) {
                console.log(euName + " read txn onabort: " + ev.target.error.name);
                that.stdFinish(0x20, 0);
            };
            if (segs < 2) {             // A single-segment read
                req = txn.objectStore(euName).get(segAddr);
                req.onsuccess = function singleReadOnsuccess(ev) {
                    that.copySegment(ev.target.result, buffer, 0);
                    that.timer = setCallback(that.mnemonic, that, finishTime - performance.now(),
                        function singleReadTimeout() {
                            this.stdFinish(0, length);
                    });
                }
            } else {                    // A multi-segment read
                range = IDBKeyRange.bound(segAddr, endAddr);

                req = txn.objectStore(euName).openCursor(range);
                req.onsuccess = function rangeReadOnsuccess(ev) {
                    var cursor = ev.target.result;

                    if (cursor) {       // found a segment at some address in range
                        // Fill buffer with zeroes for any unallocated segments
                        while (cursor.key > segAddr) {
                            that.copySegment(null, buffer, bx);
                            bx += 240;
                            segAddr++;
                        }
                        // Copy the segment data to the buffer and request next seg
                        that.copySegment(cursor.value, buffer, bx);
                        bx += 240;
                        segAddr++;
                        cursor.continue();
                    } else {            // at end of range
                        // Fill buffer with zeroes for any remaining segments in range
                        while (endAddr > segAddr) {
                            that.copySegment(null, buffer, bx);
                            bx += 240;
                            segAddr++;
                        }
                        that.timer = setCallback(that.mnemonic, that, finishTime - performance.now(),
                            function rangeReadTimeout() {
                                this.stdFinish(0, length);
                        });
                    }
                };
            }
        }
    }
};

/**************************************/
B5500DiskUnit.prototype.space = function space(finish, length, control) {
    /* Initiates a space operation on the unit */

    finish(this.errorMask | 0x04, 0);   // report unit not ready
    this.errorMask = 0;
};

/**************************************/
B5500DiskUnit.prototype.write = function write(finish, buffer, length, mode, control) {
    /* Initiates a write operation on the unit. "length" is in characters; segment address
    is in "control". "mode" is ignored (any translation will done by the IOU) */
    var bx = 0;                         // current buffer offset
    var eu;                             // EU characteristics object
    var finishTime;                     // predicted time of I/O completion, ms
    var req;                            // IDB request object
    var sectorBuf = this.sectorBuf;     // local copy
    var that = this;                    // local object context
    var txn;                            // IDB transaction object
    var x;                              // loop index for sectorBuf copy

    var segs = Math.floor((length+239)/240);
    var segAddr = control % 1000000;    // starting seg address
    var euNumber = (control % 10000000 - segAddr)/1000000;
    var euName = this.euPrefix + euNumber;
    var endAddr = segAddr+segs-1;       // ending seg address

    this.finish = finish;               // for global error handler
    eu = this.config[euName];
    if (!eu) {                          // EU does not exist
        console.log(euName + " does not exist");
        this.stdFinish(0x20, 0);        // set D27F for EU not ready
    } else if (segAddr < 0) {
        console.log(euName + " invalid starting addr");
        this.stdFinish(0x20, 0);        // set D27F for invalid starting seg address
    } else {
        if (endAddr >= eu.size) {       // if read is past end of disk
            this.errorMask |= 0x20;     // set D27F for invalid seg address
            segs = eu.size-segAddr;     // compute number of segs possible to read
            length = segs*240;          // recompute length and ending seg address
            endAddr = eu.size-1;
        }
        finishTime = this.initiateStamp +
                this.initiateStamp%eu.maxLatency + segs*240/eu.charXferRate;

        if (segs < 1) {
            // No length specified, so just finish the I/O
            this.stdFinish(0, 0);
        } else {
            // Do the write
            txn = this.db.transaction(euName, "readwrite")
            txn.onerror = function writeTxnOnError(ev) {
                console.log(euName + " write txn onerror: " + ev.target.error.name);
                that.stdFinish(0x20, 0);
            };
            txn.onabort = function writeTxnOnAbort(ev) {
                console.log(euName + " write txn onabort: " + ev.target.error.name);
                that.stdFinish(0x20, 0);
            };
            txn.oncomplete = function writeComplete(ev) {
                that.timer = setCallback(that.mnemonic, that, finishTime - performance.now(),
                    function writeTimeout() {
                        this.stdFinish(0, length);
                });
            };
            eu = txn.objectStore(euName);
            while (segAddr<=endAddr) {
                for (x=0; x<240; ++x) {
                    sectorBuf[x] = buffer[bx++];
                }
                eu.put(sectorBuf, segAddr);
                ++segAddr;
            }
        }
    }
};

/**************************************/
B5500DiskUnit.prototype.erase = function erase(finish, length) {
    /* Initiates an erase operation on the unit */

    finish(this.errorMask | 0x04, 0);   // report unit not ready
    this.errorMask = 0;
};

/**************************************/
B5500DiskUnit.prototype.rewind = function rewind(finish) {
    /* Initiates a rewind operation on the unit */

    finish(this.errorMask | 0x04, 0);   // report unit not ready
    this.errorMask = 0;
};

/**************************************/
B5500DiskUnit.prototype.readCheck = function readCheck(finish, length, control) {
    /* Initiates a read check operation on the unit. "length" is in characters;
    segment address is in "control". "mode" is ignored. This is essentially a
    read without any data transfer to memory. Note that the errorMask is NOT
    zeroed at the end of the I/O -- it will be reported with the next I/O */
    var eu;                             // EU characteristics object
    var finishTime;                     // predicted time of I/O completion, ms
    var range;                          // key range for multi-segment read
    var req;                            // IDB request object
    var that = this;                    // local object context
    var txn;                            // IDB transaction object

    this.finish = finish;               // for global error handler
    var segs = Math.floor((length+239)/240);
    var segAddr = control % 1000000;    // starting seg address
    var euNumber = (control % 10000000 - segAddr)/1000000;
    var euName = this.euPrefix + euNumber;
    var endAddr = segAddr+segs-1;       // ending seg address

    this.errorMask = 0;                 // clear any prior error mask
    eu = this.config[euName];
    if (!eu) {                          // EU does not exist
        finish(this.errorMask | 0x20, 0);       // set D27F for EU not ready
        // DO NOT clear the error mask here
        this.signal();
    } else if (segAddr < 0) {
        finish(this.errorMask | 0x20, 0);       // set D27F for invalid starting seg address
        // DO NOT clear the error mask here
        this.signal();
    } else {
        if (endAddr >= eu.size) {       // if read is past end of disk
            this.errorMask |= 0x20;     // set D27F for invalid seg address
            segs = eu.size-segAddr;     // compute number of segs possible to read
            length = segs*240;          // recompute length and ending seg address
            endAddr = eu.size-1;
        }
        finishTime = this.initiateStamp +
                this.initiateStamp%eu.maxLatency + segs*240/eu.charXferRate;

        if (segs < 1) {                 // No length specified, so just finish the I/O
            finish(this.errorMask, 0);
            // DO NOT clear the error mask -- will return it on the next interrogate
            this.signal();
        } else {                        // A multi-segment read
            range = IDBKeyRange.bound(segAddr, endAddr);
            txn = this.db.transaction(euName);
            req = txn.objectStore(euName).openCursor(range);
            req.onsuccess = function readCheckOnsuccess(ev) {
                var cursor = ev.target.result;

                if (cursor) {           // found a segment at some address in range
                    cursor.continue();
                } else {                // at end of range
                    that.timer = setCallback(that.mnemonic, that, finishTime - performance.now(),
                        function readCheckTimeout() {
                            this.signal();
                            // DO NOT clear the error mask
                    });
                }
            };

            // Post I/O complete now -- DFCU will signal when read check is finished
            finish(this.errorMask, length);
        }
    }
};

/**************************************/
B5500DiskUnit.prototype.readInterrogate = function readInterrogate(finish, control) {
    /* Initiates a read interrogate operation on the unit. This serves only to
    check the addresss for validity and to return any errorMask from a prior
    read check operation. This implementation assumes completion will be delayed
    by a random amount of time based on rotational latency for the EU to search for
    the address */
    var eu;                             // EU characteristics object
    var segAddr = control % 1000000;    // starting seg address
    var euNumber = (control % 10000000 - segAddr)/1000000;
    var euName = this.euPrefix + euNumber;

    this.finish = finish;               // for global error handler
    eu = this.config[euName];
    if (!eu) {                          // EU does not exist
        this.stdFinish(0x20, 0);        // set D27F for EU not ready
    } else {
        if (segAddr < 0 || segAddr >= eu.size) { // if read is past end of disk
            this.errorMask |= 0x20;     // set D27F for invalid seg address
        } else if (eu.slow) {
            this.errorMask |= 0x10;     // set D28F (lockout bit) to indicate Mod IB (slow) disk
        }
        this.timer = setCallback(this.mnemonic, this,
            this.initiateStamp%eu.maxLatency + this.initiateStamp - performance.now(),
            function readInterrogateTimeout() {
                this.stdFinish(0, 0);
        });
    }
};

/**************************************/
B5500DiskUnit.prototype.writeInterrogate = function writeInterrogate(finish, control) {
    /* Initiates a write interrogate operation on the unit. This serves only to
    check the addresss for validity and to return any errorMask from a prior
    read check operation. This implementation assumes completion will be delayed
    by a random amount of time based on rotational latency for the EU to search for
    the address */

    /* Note: until disk write lockout is implemented, this operation is identical
    to readInterrogate() */

    var eu;                             // EU characteristics object
    var segAddr = control % 1000000;    // starting seg address
    var euNumber = (control % 10000000 - segAddr)/1000000;
    var euName = this.euPrefix + euNumber;

    this.finish = finish;               // for global error handler
    eu = this.config[euName];
    if (!eu) {                          // EU does not exist
        this.stdFinish(0x20, 0);        // set D27F for EU not ready
    } else {
        if (segAddr < 0 || segAddr >= eu.size) { // if read is past end of disk
            this.errorMask |= 0x20;     // set D27F for invalid seg address
        }
        this.timer = setCallback(this.mnemonic, this,
            this.initiateStamp%eu.maxLatency + this.initiateStamp - performance.now(),
            function writeInterrogateTimeout() {
                this.stdFinish(0, 0);
        });
    }
};

/**************************************/
B5500DiskUnit.prototype.shutDown = function shutDown() {
    /* Shuts down the device */

    if (this.timer) {
        clearCallback(this.timer);
    }
    if (this.db) {
        if (!this.db.closed) {
            this.db.close();
            this.db = null;
        }
    }
    // this device has no window to close
};
