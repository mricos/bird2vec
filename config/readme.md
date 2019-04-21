## Configuration and Investigation

### This directory serves as a proof of concept/functionality for training [Chris Donahue's](https://github.com/chrisdonahue/wavegan) Tensorflow implementation of a WaveGAN on Google Colab.
The notebook **wavegan_tf112_py36.ipynb** outlines the necessary steps to train a WaveGAN using google colaboratory and store the results in a google drive.
Note: This implementation trains on the SC09 dataset (digits 0-9 spoken in English).

The notebook **tensorboard_wavegan.ipynb** is the notebook that allows the monitoring of the training through colab.

**Considerations:**
There are two major drawbacks of training on colab with a free gogole drive:
  - 12 hour kernel life-cycle
  - 15gb memory limit
  
Details:
The training phase of this model requires a lot of space. Each checkpoint consumes about 420mb of memory.  Therefore, if you are using a free google drive, the limit of 15gbs may not be enough to train a model. While the model trains, it will save 5 checkpoints in the training directory, moving the oldest checkpoint to the trash. However, the trash portion of your google drive is still considered as occupied space. **One workaround** is to monitor the trash and empty it periodically, however the space figures aren't updated in real time so it is hard to know how much space is actually being used. Furthermore if you let the kernel run for 12hours, the checkpoint that tensorboard sees and what you will actually end up with may not be the same.  This will cause your model to error out when you try to resume training from the same training directory.

**Solution**
The best solution to these problems is to set your training directory to ``` /content/train_dir_name ``` and then periodically stop  training the model and move the entire directoy ``` /content/train_dir_name ``` to somewhere on your google drive. This will ensure that:
  1. You wont run out of space (usually this directory has around 300gb of available space)
  2. The checkpoint being read and the checkpoint.data will align.  
  
Then when you start a new instance, you can move the training directory back to ```/content/``` and the model will resume.

Example workflow:
  1. Stop the model
  2. run ```!cp /content/train_dir_name /content/gdrive/My\ Drive/train_dir_name```
  3. Verify the folder was copied (specifically checkpoint.data,checkpoint.index, and checkpoint.meta)
  4. Reset all runtimes
  5. run ```!cp /content/gdrive/My\ Drive/train_dir_name /content/train_dir_name```
  6. Rerun notebook to resume training.
  
Do not forget to change the path in the training command. Also, if you are using Tensorboard to monitor, you will need to change the path in the tensorboard command as well.
