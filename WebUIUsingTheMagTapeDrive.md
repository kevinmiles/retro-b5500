# WebUI Using the Magnetic Tape Drive #



The B5500 supported several 7-track tape drive models, with recording densities of 200, 555, and 800 bits per inch. Not all drives supported all densities. Tape speed ranged from 83 to 120 inches per second, with data transfer ranges ranging in concert from 66,000 to 96,000 characters per second. Blocks of data on the tape were delimited by a 0.75-inch unrecorded gap. Rewind speed was 320 inches/second, taking about 90 seconds for a full 2400-foot reel of tape.

All drives could record in even or odd parity. With even parity (also termed alpha mode), characters were translated to and from BCL (Burroughs Common Language), which was very similar to the character codes used with IBM 1401 tape drives. With odd parity (binary mode), bits were recorded without translation from their internal representation in the B5500 core memory.

A B5500 system could have up to 16 tape drives, identified as `MTA` through `MTT` (with letters `G`, `I`, `O`, and `Q` not used).

Here is a view of a B42x-series drive with its front door open, showing the tape head, pinch-roller mechanisms, and tape columns:

> ![https://googledrive.com/host/0BxqKm7v4xBswRjNYQnpqM0ItbkU/MagTape-Drive-burr0136.jpg](https://googledrive.com/host/0BxqKm7v4xBswRjNYQnpqM0ItbkU/MagTape-Drive-burr0136.jpg)


# Background #

The tape drive interface we have developed for the web-based emulator is modeled after the 90 inch-per-second B425, operating at 800 bpi. This interface opens in a separate window when the **POWER ON** button is activated on the emulator console:

> ![https://googledrive.com/host/0BxqKm7v4xBswRjNYQnpqM0ItbkU/B5500-MagTapeDrive.png](https://googledrive.com/host/0BxqKm7v4xBswRjNYQnpqM0ItbkU/B5500-MagTapeDrive.png)

The B425 had additional buttons and lights for power on/off, but these controls are not relevant to operation under the emulator.

A 2400-foot reel of tape has a capacity of 2-22 million characters, depending on the size of the blocks recorded. A typical capacity is 10-15 million characters.

Data for tape volumes ("reels") may be maintained externally as ordinary workstation files. Such a file is referred to as a "tape image." This tape drive implementation supports the following tape image formats:

  * **"`.bcd`"** -- In this format, each 7-bit frame on the tape is stored in one 8-bit byte. The low-order six bits of the byte contain the data, low-order bit last. The seventh bit is parity. The high-order bit in the byte is a one if this frame starts a physical block on the tape. A tape mark (end-of-file indicator) is represented by a single-frame block with the hexadecimal value 8F (i.e., an even-parity BCL greater-than-or-equal character). The same tape mark encoding is used with both even and odd parity recording.
  * **Text** -- In this format, the tape image is a standard text file. Each 7-bit frame on the tape is stored as one ASCII character. Each physical tape block is represented as one line of text in the image file. Lines of text may be delimited by a carriage-return, a line-feed (new-line), a form-feed, a carriage-return/line-feed pair, or a carriage-return/form-feed pair. A tape image can be loaded into the system as either even or odd parity, but the characters in the text image are represented the same either way. A tape mark is represented by a line with a single "`}`" (greater-than-or-equal) character. Note that in this format, the length of a tape block is determined by the length of its ASCII line of text, so trailing spaces are significant, and tab-compression may not be used.

Lines of text for a tape image should be composed using the emulator's version of the B5500 64-character set:

```
    0 1 2 3 4 5 6 7
    8 9 # @ ? : > {
    + A B C D E F G
    H I . [ & ( < ~
    | J K L M N O P
    Q R $ * - 0 ; {
      / S T U V W X
    Y Z , % ! = } "
```

The B5500 used five special Algol characters that do not have ASCII equivalents. The emulator uses the following ASCII substitutions for them:

  * `~` for left-arrow
  * `|` for the small-cross (multiplication sign)
  * `{` for less-than-or-equal
  * `}` for greater-than-or-equal
  * `!` for not-equal

The tape drive interface will translate lower-case ASCII letters to upper case. The drive will consider all other ASCII or Unicode characters to be vertical-parity errors in a tape frame. None of the current tape image formats support the concept of longitudinal (block-check) parity.

By default, the B5500 MCP brackets each file on the tape with 80-character label records. These label records serve to identify the tape reel and file names, and to provide the record size, block size, creation date, and expiration date for the tape.

Tape files have a two-part name, the MFID (multi-file identifier, which is the same for all files on one logical volume), and the FID (file identifier), which should uniquely identify the file within the logical volume. Each of these names can be up to seven characters in length. A logical tape volume can extend across multiple physical reels of tape.

This two-level naming convention was first established for tapes on the B5000, and later carried into the design of the B5500 MCP disk directory. It eventually made its way into the design of the disk directory for Gary Kildall's CPM operating system.

When a tape is mounted on a drive and the drive made ready, the MCP will automatically read the label and assign the drive to any program that has asked for a file by the names specified on the label. If only the MFID matches, the MCP will automatically search up-tape for a file with the matching FID. Unlabeled tapes are also supported by the MCP, but are less convenient, as they typically need to be assigned manually to a program using the SPO `UL` command.

Tapes marked as "scratch" will be assigned automatically to programs requiring an output tape. Tapes may be "scratched" using the SPO `PG` command.


# Tape Drive Control Panel #

The user interface for the emulated tape drive consists of the following controls and indicators:

  * **UNLOAD** -- this black button is used to unload a tape image from the drive. This button is active only when an image is currently loaded, the drive is in local (not-ready) status, and the tape is positioned at BOT (beginning of tape).
  * **LOAD** -- this black button is used to load a tape image file into the drive as if it were a reel of tape. The button is active only when no image is currently loaded into the drive. Clicking this button will bring up the tape loader dialog to select an image file, as described below.
  * **LOCAL** -- this yellow button/indicator lights when the drive is in a not-ready status. The drive becomes ready when a tape image is loaded and the **REMOTE** button is clicked. It becomes not-ready when this button is clicked.
  * **REMOTE** -- this yellow button/indicator lights when the drive is in a ready status. The drive becomes ready when a tape image is loaded and this button is clicked. It becomes not-ready when the **LOCAL** button is clicked.
  * **WRITE RING** -- This red button/indicator is used to signal and control whether the tape image that is currently mounted is enabled for writing. When this button is lit, the image is writable. Writable status can only be set (i.e., the write ring can be inserted) during the process of loading a tape image. Writable status can be reset (i.e., the write ring can be pulled) at any time while an image is loaded, even while it is in use.
  * **REWIND** -- clicking this black button will rewind the tape image to its load point at the beginning of the image. The button is active only when a tape image is loaded into the drive and the drive is in local status.

When a tape image is loaded into the drive, an icon representing a reel of tape will appear next to the rewind button.  While not shown on the picture above, there are white annunciators along the right edge of the panel showing the status of the tape image:

  * **UNLOADED** -- indicates that no tape image is currently loaded into the drive.
  * **AT BOT** -- indicates that a tape image is loaded and is currently positioned at the beginning of the tape, or "load point."
  * **AT EOT** -- indicates that a tape image is loaded and is currently positioned past the end-of-tape marker.
  * **REWINDING** -- indicates that the drive is currently rewinding to the load point of the image.

Below the buttons is a text area. This is initially blank, but after a tape image is loaded into the drive it will display either the name of the image file that was loaded, or "`(blank tape)`" if a blank image was loaded.

Below the text is a progress bar. This shows the relative amount of data from the tape image remaining on the "supply reel." When you load a tape image into the drive, this bar is set to 100% at its far right edge. As the tape moves in the forward direction, the length of the bar will decrease towards the left; as the tape moves backward, the length of the bar will increase towards the right.


## Loading a Tape Image ##

Before a tape drive can be assigned to a user program or the MCP, a tape image must be loaded into it. Clicking the **LOAD** button initiates the load process and displays a dialog box for that purpose:

> ![https://googledrive.com/host/0BxqKm7v4xBswRjNYQnpqM0ItbkU/B5500-MagTapeLoader.png](https://googledrive.com/host/0BxqKm7v4xBswRjNYQnpqM0ItbkU/B5500-MagTapeLoader.png)

There are two types of tape images that can be loaded into the drive: an image from an existing file, and a blank image.

  1. To load an image from an existing file, use the file-picker control at the top of the dialog to select the file from your local file system. The interface will infer the type of image format from the file name extension as follows:
    * "`.bcd`" implies a ".bcd" tape image.
    * Anything else implies an "ASCII Odd Parity" text image.
  1. To load a blank image into the drive, do not use the file-picker control. Select "`(blank tape)`" from the **Format** drop-down list. This is the default setting when the loader dialog opens.

You may use the **Format** drop-down list to change the inferred image type after a file is loaded. Internally, the emulator uses the .bcd format to store and manipulate the tape image data. It converts between this format and the external format as necessary when loading and unloading tape images.

A file must be selected unless you are loading a blank tape, in which case any file that may have been selected is ignored.

Once a tape image is selected, there are two optional controls that you may use:

  * **Write Ring** -- checking this box will make the image writable and illuminate the Write Ring button on the tape drive window. When loading a blank tape image, this setting will be forced.
  * **Tape Length** -- selecting an item from this drop-down list will specify the total length of the tape image. This is significant only when the **Write Ring** box is checked and the image is to be writable. The drop-down list of tape lengths is disabled otherwise. There are three choices for length: 600 feet, 1200 feet, and 2400 feet (the default), corresponding to the most common reel sizes that were used for 7-track magnetic tape. If an image file is larger than the selected length, the actual image length plus the equivalent of 20 feet of tape will be used instead.

You can select only one file at a time to load into the drive. The emulator does not attempt to verify that any file you load is a valid tape image. An invalid image file or a mismatch between the selected format and the image data will generally result in parity errors during read operations.

Once you have the parameters for the tape image specified, click the **OK** button to complete the load process, or click **Cancel** to abort the load and leave the drive in an unloaded state. Clicking either of these buttons will cause the loader dialog to close.

After the tape image is loaded into the drive, the drive will remain in local (not-ready) status. You must click the **REMOTE** button to make the drive ready and available to the MCP.


## Unloading a Tape Image ##

If you load a tape image into the drive with its write ring enabled, and the system actually writes on that image, then when you unload the image from the drive the emulator will offer you the option to save the image. Note that when the write ring is enabled, any writes to the tape do not affect the file from which you loaded the tape image. All tape operations affect only the internal tape image data resident in memory.

If the image is read-only or has not been written to, clicking the **UNLOAD** button will simply discard the internal image data and leave the drive in an unloaded state.

If the image has been written to, clicking the **UNLOAD** button will cause a dialog box to open, asking whether you want to save the image data.

  * If you click **Cancel** on this dialog, the internal image data will be discarded and the drive set to an unloaded state, as above.
  * If you click **OK** on this dialog, the emulator will open a blank window and format the final contents of the internal tape image to that window as an ASCII text image. For full-tape images, this conversion from the internal ".bcd" format to ASCII text may take several seconds.
  * Once the tape image data is displayed in the window, you may save the text to a file on your local workstation or copy/paste the text into another program, such as a text editor.
  * If you choose to paste the text into another program, you should disable any options in that program that will trim trailing spaces from lines or compress multiple spaces using tab characters, as these may cause the image to become corrupted.
  * Once you have saved or copied the tape image data, simply close the window that was opened by the **UNLOAD** button.

Note that regardless of the format of the image you loaded into the drive, unloading and saving the internal image data will always be done using the ASCII text format. Other formats involve binary data with non-printing characters, which at present are not practical to output from a web browser to your local file system.


# Operating the Magnetic Tape Drive #

The basic technique used with the tape drive is simple -- use the **LOAD** button to select a tape image for loading into the drive, then click the **REMOTE** button to make the drive ready. The MCP should recognize the ready status and attempt to read the tape label. If the file names in the label match the file names requested by a program, the drive will be assigned to the program automatically. Automatic name matching can be overridden on input using the SPO `IL` and `UL` commands.

Tape output is generally done only to "scratch" volumes, which may be created with the `PG` SPO command. To scratch an existing tape, simply enter "`PG MT`x". Its existing volume number will be preserved in the scratch label. To scratch a tape and assign a volume number, enter "`PG MT`x`-`nnnnn", where "nnnnn" is the volume number, which may be one to five digits in length. The "`-`" delimiter is required and may not be prefixed or suffixed by spaces.

The B5500 MCP will treat blank tapes as scratch with a volume number of 00000.

The `OU` SPO command can be used to direct output to a specific drive.

You can stop the drive at any time and make it not-ready by clicking the **LOCAL** button. Restart it by clicking the **REMOTE** button. Whenever the drive is in a not-ready status, you can rewind or unload the tape image.

Library/Maintenance is the portion of the MCP that manages disk files and maintains the disk directory. Among its features is the capability to dump disk files to and load disk files from magnetic tape. This is typically used for file backup, archiving, and transferring files among systems.

Disk files can be loaded from Library/Maintenance volumes such as the `SYSTEM`, `SYMBOL1`, and `SYMBOL2` tape images using the `LOAD` and `ADD` control card commands, e.g.,

```
    ?LOAD FROM SYSTEM ESPOL/DISK, COBOL/DISK, DUMP/ANALYZE
```

A control card command can be continued across multiple card images by terminating a card with a hyphen ("`-`") wherever a word or other punctuation character might appear. The continuation card(s) that follow must not have an invalid character in column 1.

All files having the same first or last identifier in their file name may be loaded by specifying `MFID/=` or `=/FID`. All files from a tape can be loaded by specifying `=/=`. Library/Maintenance will not overwrite certain critical system files, such as the current MCP, Intrinsics, and system log.

The `ADD` command works the same as `LOAD`, except that it loads only files that are not already in the disk directory.

Disk files can be dumped to Library/Maintenance volumes using the `DUMP` control card command, e.g.,

```
    ?DUMP TO BKUP CANDE/USERS, =/DISK, DATA/=
```

The MCP will automatically detect the end of a tape reel and request another tape if the amount of data to be dumped overflows the first reel. The MCP will refuse to dump certain files, such as the system log and disk directory.

See Section 4, and in particular page 4-15 ff, in http://bitsavers.org/pdf/burroughs/B5000_5500_5700/1024916_B5500_B5700_OperMan_Sep68.pdf for more information on control card syntax and the Library/Maintenance commands.