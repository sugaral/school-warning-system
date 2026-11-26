<template>
	<xn-form-container
		:title="formData.id ? '编辑专业' : '新增专业'"
		:width="520"
		:visible="visible"
		:destroy-on-close="true"
		@close="onClose"
	>
		<a-form ref="formRef" :model="formData" :rules="formRules" layout="vertical">
			<a-form-item label="所属学院：" name="orgId">
				<a-tree-select
					v-model:value="formData.orgId"
					class="xn-wd"
					placeholder="请选择学院"
					:tree-data="treeData"
					:field-names="{ children: 'children', label: 'name', value: 'id' }"
					:load-data="onLoadData"
					tree-line
					allow-clear
				/>
			</a-form-item>
			<a-form-item label="专业名称：" name="name">
				<a-input v-model:value="formData.name" placeholder="请输入专业名称" allow-clear />
			</a-form-item>
			<a-form-item label="专业编码：" name="code">
				<a-input v-model:value="formData.code" placeholder="请输入专业编码（选填）" allow-clear />
			</a-form-item>
			<a-form-item label="状态：" name="status">
				<a-radio-group v-model:value="formData.status">
					<a-radio value="active">启用</a-radio>
					<a-radio value="inactive">停用</a-radio>
				</a-radio-group>
			</a-form-item>
		</a-form>
		<template #footer>
			<a-button class="xn-mr8" @click="onClose">关闭</a-button>
			<a-button type="primary" :loading="submitLoading" @click="onSubmit">保存</a-button>
		</template>
	</xn-form-container>
</template>

<script setup name="bizMajorForm">
	import { required } from '@/utils/formRules'
	import bizMajorApi from '@/api/biz/bizMajorApi'

	defineProps({
		treeData: { type: Array, default: () => [] },
		onLoadData: { type: Function, default: undefined }
	})
	const emit = defineEmits({ successful: null })

	const visible = ref(false)
	const formRef = ref()
	const formData = ref({})
	const submitLoading = ref(false)

	const formRules = {
		orgId: [required('请选择所属学院')],
		name: [required('请输入专业名称')]
	}

	const onOpen = (record, orgId) => {
		visible.value = true
		formData.value = { status: 'active' }
		if (orgId) formData.value.orgId = orgId
		if (record) formData.value = Object.assign({}, record)
	}

	const onClose = () => {
		visible.value = false
	}

	const onSubmit = () => {
		formRef.value
			.validate()
			.then(() => {
				submitLoading.value = true
				bizMajorApi
					.submitForm(formData.value, !!formData.value.id)
					.then(() => {
						visible.value = false
						emit('successful')
					})
					.finally(() => {
						submitLoading.value = false
					})
			})
			.catch(() => {})
	}

	defineExpose({ onOpen })
</script>
